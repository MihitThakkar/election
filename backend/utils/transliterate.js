// Roman (English) → Devanagari (Hindi) transliterator for fuzzy name search.
//
// The function generates a small set of candidate Devanagari spellings for a
// Roman query and returns them all, so the SQL search can OR-match against
// the stored Hindi name. We deliberately over-generate (a few variants) to
// cover the common ambiguities — vowel length (i↔ī, u↔ū), retroflex vs dental
// (t/d → ट/त, ड/द), nasalization, and final-schwa drop.
//
// This is intentionally lightweight (no external deps) and tuned for the
// short single-word names that appear in voter rolls.

// Multi-char consonant clusters tried first (longest match wins).
// Each maps to one or more Devanagari variants — e.g. 'sh' can render as श or ष.
const CONSONANT_CLUSTERS = [
  ['ksh', ['क्ष']], ['shr', ['श्र']], ['gya', ['ज्ञ']], ['jny', ['ज्ञ']],
  ['chh', ['छ']],   ['sh',  ['श', 'ष']],
  ['kh',  ['ख']],   ['gh',  ['घ']],
  ['ch',  ['च']],   ['jh',  ['झ']],
  ['th',  ['थ', 'ठ']],   ['dh',  ['ध', 'ढ']],
  ['ph',  ['फ', 'फ़']],   ['bh',  ['भ']],
  ['ng',  ['ङ']],
];

// Single consonants — some have retroflex/dental ambiguity (we'll branch later)
const CONSONANTS = {
  k: ['क'],
  g: ['ग'],
  c: ['च'],
  j: ['ज'],
  t: ['त', 'ट'],   // dental and retroflex variants
  d: ['द', 'ड'],
  n: ['न', 'ण'],
  p: ['प'],
  f: ['फ'],
  b: ['ब'],
  m: ['म'],
  y: ['य'],
  r: ['र'],
  l: ['ल'],
  v: ['व'],
  w: ['व'],
  s: ['स', 'श'],
  h: ['ह'],
  z: ['ज़', 'ज'],
  q: ['क'],
  x: ['क्स'],
};

// Vowels (independent and matra forms). For each Roman vowel the first form
// is the matra (when after a consonant); the second is the independent form
// (used at start of word).
//
// Note: 'ri' is intentionally NOT a vowel here — names like 'priya' should
// tokenize as p-r-i-y-a (giving प्रिया), not p-rri-y-a. The ृ matra is
// uncommon in modern Indian names. Words like 'krishna' still work because
// they parse as k-r-i-sh-n-a → कृष्ण-style after halant logic.
const VOWELS = {
  aa: { matra: 'ा',  indep: 'आ' },
  a:  { matra: '',   indep: 'अ' },        // schwa: no matra, often silent at end
  ee: { matra: 'ी',  indep: 'ई' },
  ii: { matra: 'ी',  indep: 'ई' },
  i:  { matra: 'ि',  indep: 'इ', alt_matra: 'ी', alt_indep: 'ई' },
  oo: { matra: 'ू',  indep: 'ऊ' },
  uu: { matra: 'ू',  indep: 'ऊ' },
  u:  { matra: 'ु',  indep: 'उ', alt_matra: 'ू', alt_indep: 'ऊ' },
  e:  { matra: 'े',  indep: 'ए' },
  ai: { matra: 'ै',  indep: 'ऐ' },
  o:  { matra: 'ो',  indep: 'ओ' },
  au: { matra: 'ौ',  indep: 'औ' },
};

// 'ri' as vocalic-R is rare in modern Indian names; we'd rather match
// 'priya' as प्रिया than पृया. Special words like 'krishna' are handled by
// post-generation: when input STARTS with one of these prefixes, we
// additionally emit a variant where 'consonant + ्र + ि' collapses to
// 'consonant + ृ' (vocalic-R matra). 'pri' is intentionally excluded —
// modern names like Priya/Pritam render with ि, not ृ.
const RI_VARIANT_PREFIXES = ['kri', 'shri', 'tri', 'dri', 'gri', 'bri', 'mri'];

const HALANT = '्';

function isAlpha(ch) {
  return /[a-z]/.test(ch);
}

// Tokenize Roman string into syllables: [consonant-cluster][vowel]
function tokenize(input) {
  const s = input.toLowerCase().replace(/[^a-z]/g, '');
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    // 1) consonant (try longest cluster first)
    let consonant = null;
    let consumed = 0;
    for (const [k] of CONSONANT_CLUSTERS) {
      if (s.startsWith(k, i)) {
        consonant = k;
        consumed = k.length;
        break;
      }
    }
    if (!consonant && CONSONANTS[s[i]]) {
      consonant = s[i];
      consumed = 1;
    }
    i += consumed;

    // 2) vowel (try 2-char then 1-char)
    let vowel = null;
    if (i + 1 < s.length && VOWELS[s.substr(i, 2)]) {
      vowel = s.substr(i, 2);
      i += 2;
    } else if (VOWELS[s[i]]) {
      vowel = s[i];
      i += 1;
    }

    if (!consonant && !vowel) {
      // unrecognized char — skip
      i += 1;
      continue;
    }
    tokens.push({ consonant, vowel });
  }
  return tokens;
}

// Build Devanagari from a token sequence using one set of choices.
// `consonantPicks[i]` selects the i-th token's consonant variant.
// `vowelAltPicks[i]` toggles long/short vowel for token i (i↔ī, u↔ū).
// `aToAa` makes all schwa 'a' render as long 'aa' (आ/ा).
// `finalAa` only promotes the FINAL 'a' to 'aa' (kavita → कविता vs काविता).
// `preserveSchwa` skips halant for no-vowel tokens (bhavna: व without ्).
function build(tokens, opts = {}) {
  const {
    consonantPicks = [],
    vowelAlt = false,
    vowelAltPicks = [],
    aToAa = false,
    finalAa = false,
    preserveSchwa = false,
  } = opts;

  // Index of the last token whose vowel is 'a' (for finalAa)
  let lastAIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].vowel === 'a') { lastAIdx = i; break; }
  }

  let out = '';
  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx];
    const isLast = idx === tokens.length - 1;

    let consonantChar = '';
    if (tok.consonant) {
      let variants;
      const cluster = CONSONANT_CLUSTERS.find(([k]) => k === tok.consonant);
      if (cluster) {
        variants = cluster[1];
      } else {
        variants = CONSONANTS[tok.consonant] || [];
      }
      const pick = consonantPicks[idx] ?? 0;
      consonantChar = variants[Math.min(pick, variants.length - 1)] || '';
    }

    let vowelMatra = '';
    let vowelIndep = '';
    if (tok.vowel) {
      let v = VOWELS[tok.vowel];
      // aToAa: promote ALL schwa 'a' → long 'aa'
      // finalAa: promote only the LAST 'a' → 'aa'
      if (tok.vowel === 'a' && (aToAa || (finalAa && idx === lastAIdx))) {
        v = VOWELS.aa;
      }
      const useAlt = vowelAlt || (vowelAltPicks[idx] === 1);
      vowelMatra = useAlt && v.alt_matra ? v.alt_matra : v.matra;
      vowelIndep = useAlt && v.alt_indep ? v.alt_indep : v.indep;
    }

    if (consonantChar) {
      out += consonantChar;
      if (tok.vowel) {
        out += vowelMatra; // matra (empty for schwa 'a')
      } else if (!isLast && !preserveSchwa) {
        // consonant followed by another consonant → halant
        // (preserveSchwa keeps the implicit schwa instead — bhavna → भावना)
        out += HALANT;
      }
    } else if (vowelIndep) {
      // vowel without consonant — independent form (typically word-initial)
      out += vowelIndep;
    }
  }
  return out;
}

// Post-process: collapse '<consonant>्रि' → '<consonant>ृ' (vocalic-R).
// Applied only for inputs starting with kri/shri/tri/etc. (not pri/sri).
function applyVocalicR(cand) {
  return cand.replace(/([\u0915-\u0939\u0958-\u095F])\u094D\u0930\u093F/g, '$1\u0943');
}

// Generate Devanagari candidates from a Roman query. We over-generate
// (8-12 distinct variants) so the SQL search OR-matches against the most
// common renderings. The variants combine: retroflex flips, long/short
// vowel swap, sh→ष swap, and schwa→aa promotion.
function transliterate(input, limit = 36) {
  const tokens = tokenize(input);
  if (!tokens.length) return [];

  const candidates = new Set();
  const lower = (input || '').toLowerCase();
  const wantsVocalicR = RI_VARIANT_PREFIXES.some(p => lower.startsWith(p));

  // Identify token indices that have multiple consonant variants
  const ambigIdx = [];
  tokens.forEach((tok, i) => {
    if (!tok.consonant) return;
    const cluster = CONSONANT_CLUSTERS.find(([k]) => k === tok.consonant);
    const variants = cluster ? cluster[1] : (CONSONANTS[tok.consonant] || []);
    if (variants.length > 1) ambigIdx.push(i);
  });

  // Generate combinations: each ambiguous consonant picks 0 or 1.
  // To avoid explosion, cap at first 3 ambiguous positions.
  const branchCount = Math.min(ambigIdx.length, 3);
  const totalBranches = 1 << branchCount;

  // Per-token vowel-alt for i/u — handles names like 'sunil' (सुनील: short u, long i)
  const vowelAmbigIdx = [];
  tokens.forEach((tok, i) => {
    if (tok.vowel === 'i' || tok.vowel === 'u') vowelAmbigIdx.push(i);
  });
  const vBranchCount = Math.min(vowelAmbigIdx.length, 3);
  const totalVBranches = 1 << vBranchCount;

  // Enumerate (aToAa, finalAa, preserveSchwa) — 6 useful combos
  // (skip aToAa+finalAa since aToAa subsumes finalAa)
  const longAFlags = [
    { aToAa: false, finalAa: false },
    { aToAa: false, finalAa: true  },
    { aToAa: true,  finalAa: false },
  ];
  const schwaFlags = [false, true];

  const addCand = (cand) => {
    if (!cand) return;
    // Vocalic-R variant first when prefix matches — these are usually the
    // intended spelling (कृष्ण over क्रिश्न), so promote them in the result list.
    if (wantsVocalicR) {
      const r = applyVocalicR(cand);
      if (r !== cand) {
        candidates.add(r);
        const ra = r.replace(/[नम]्(?=[\u0915-\u0939\u0958-\u095F])/g, 'ं');
        if (ra !== r) candidates.add(ra);
      }
    }
    candidates.add(cand);
    // Anusvara variant: replace न्/म् + consonant with ं
    const anusvara = cand.replace(/[नम]्(?=[\u0915-\u0939\u0958-\u095F])/g, 'ं');
    if (anusvara !== cand) candidates.add(anusvara);
  };

  for (let mask = 0; mask < totalBranches; mask++) {
    const picks = tokens.map(() => 0);
    for (let b = 0; b < branchCount; b++) {
      if (mask & (1 << b)) picks[ambigIdx[b]] = 1;
    }
    for (let vmask = 0; vmask < totalVBranches; vmask++) {
      const vpicks = tokens.map(() => 0);
      for (let b = 0; b < vBranchCount; b++) {
        if (vmask & (1 << b)) vpicks[vowelAmbigIdx[b]] = 1;
      }
      for (const longA of longAFlags) {
        for (const preserveSchwa of schwaFlags) {
          addCand(build(tokens, {
            consonantPicks: picks,
            vowelAltPicks: vpicks,
            aToAa: longA.aToAa,
            finalAa: longA.finalAa,
            preserveSchwa,
          }));
        }
      }
    }
  }

  return Array.from(candidates).slice(0, limit);
}

// Detect whether a string contains any Devanagari char
function hasDevanagari(s) {
  return /[\u0900-\u097F]/.test(s || '');
}

// Detect whether a string is mostly Latin (search query in English)
function isRoman(s) {
  if (!s) return false;
  return !hasDevanagari(s) && /[a-zA-Z]/.test(s);
}

module.exports = {
  transliterate,
  hasDevanagari,
  isRoman,
};
