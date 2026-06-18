// ========== Seeded PRNG: xoshiro128** ==========
// Fast, high-quality, deterministic random number generator

function splitmix32(a) {
  return function() {
    a |= 0; a = a + 0x9e3779b9 | 0;
    let t = a ^ a >>> 16;
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ t >>> 15) >>> 0) / 4294967296;
  };
}

function createPRNG(seed) {
  // Initialize state from seed using splitmix32
  const init = splitmix32(seed);
  let s0 = Math.floor(init() * 4294967296) >>> 0;
  let s1 = Math.floor(init() * 4294967296) >>> 0;
  let s2 = Math.floor(init() * 4294967296) >>> 0;
  let s3 = Math.floor(init() * 4294967296) >>> 0;

  function next() {
    const result = Math.imul(s1, 5) >>> 0;
    const rot = (s1 << 9 | s1 >>> 23) >>> 0;
    const t = (s1 << 1) >>> 0;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = (rot) >>> 0;
    return (((result >>> 0) + (rot >>> 0)) >>> 0) / 4294967296;
  }

  return {
    next,
    nextInt(max) {
      return Math.floor(next() * max);
    },
    get state() {
      return [s0, s1, s2, s3];
    }
  };
}

// Export for Worker context
if (typeof self !== 'undefined') {
  self.createPRNG = createPRNG;
}
