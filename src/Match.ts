export interface MatchParams {
  /** At what point is no match declared (0.0 = perfection, 1.0 = very loose). */
  threshold?: number
  /**
   * How far to search for a match (0 = exact location, 1000+ = broad match).
   * A match this many characters away from the expected location will add
   * 1.0 to the score (0.0 is a perfect match).
   */
  distance?: number
  /** The number of bits in an int. */
  maxBits?: number
}

/**
 * Class containing match methods.
 */
export default class Match {
  threshold: number
  distance: number
  maxBits: number

  constructor ({ threshold, distance, maxBits }: MatchParams = {}) {
    this.threshold = threshold ?? 0.5
    this.distance = distance ?? 1000
    this.maxBits = maxBits ?? 32
  }

  //  MATCH FUNCTIONS

  /**
   * Locate the best instance of 'pattern' in 'text' near 'loc'.
   * @param {string} text The text to search.
   * @param {string} pattern The pattern to search for.
   * @param {number} loc The location to search around.
   * @return {number} Best match index or -1.
   */
  main (text: string, pattern: string, loc: number): number {
    // Check for null inputs.
    if (text == null || pattern == null || loc == null) {
      throw new Error('Null input. (main)')
    }

    loc = Math.max(0, Math.min(loc, text.length))
    if (text === pattern) {
      // Shortcut (potentially not guaranteed by the algorithm)
      return 0
    } else if (text.length === 0) {
      // Nothing to match.
      return -1
    } else if (text.substring(loc, loc + pattern.length) === pattern) {
      // Perfect match at the perfect spot!  (Includes case of null pattern)
      return loc
    } else {
      // Do a fuzzy compare.
      return this.bitap(text, pattern, loc)
    }
  }

  /**
   * Locate the best instance of 'pattern' in 'text' near 'loc' using the
   * Bitap algorithm.
   * @param {string} text The text to search.
   * @param {string} pattern The pattern to search for.
   * @param {number} loc The location to search around.
   * @return {number} Best match index or -1.
   */
  bitap (text: string, pattern: string, loc: number): number {
    if (pattern.length > this.maxBits) {
      throw new Error('Pattern too long for this browser.')
    }

    // Initialise the alphabet.
    const s = this.alphabet(pattern)

    /**
     * Compute and return the score for a match with e errors and x location.
     * Accesses loc and pattern through being a closure.
     * @param {number} e Number of errors in match.
     * @param {number} x Location of match.
     * @return {number} Overall score for match (0.0 = good, 1.0 = bad).
     * @private
     */
    const bitapScore = (e: number, x: number): number => {
      const accuracy = e / pattern.length
      const proximity = Math.abs(loc - x)
      if (this.distance === 0) {
        // Dodge divide by zero error.
        return proximity !== 0 ? 1.0 : accuracy
      }
      return accuracy + (proximity / this.distance)
    }

    // Highest score beyond which we give up.
    let scoreThreshold = this.threshold
    // Is there a nearby exact match? (speedup)
    let bestLoc = text.indexOf(pattern, loc)
    if (bestLoc !== -1) {
      scoreThreshold = Math.min(bitapScore(0, bestLoc), scoreThreshold)
      // What about in the other direction? (speedup)
      bestLoc = text.lastIndexOf(pattern, loc + pattern.length)
      if (bestLoc !== -1) {
        scoreThreshold =
          Math.min(bitapScore(0, bestLoc), scoreThreshold)
      }
    }

    // Initialise the bit arrays.
    const matchmask = 1 << (pattern.length - 1)
    bestLoc = -1

    let binMin, binMid
    let binMax = pattern.length + text.length
    let lastRd: number[] = []
    for (let d = 0; d < pattern.length; d++) {
      // Scan for the best match; each iteration allows for one more error.
      // Run a binary search to determine how far from 'loc' we can stray at this
      // error level.
      binMin = 0
      binMid = binMax
      while (binMin < binMid) {
        if (bitapScore(d, loc + binMid) <= scoreThreshold) {
          binMin = binMid
        } else {
          binMax = binMid
        }
        binMid = Math.floor((binMax - binMin) / 2 + binMin)
      }
      // Use the result from this iteration as the maximum for the next.
      binMax = binMid
      let start = Math.max(1, loc - binMid + 1)
      const finish = Math.min(loc + binMid, text.length) + pattern.length

      const rd = Array<number>(finish + 2)
      rd[finish + 1] = (1 << d) - 1
      for (let j = finish; j >= start; j--) {
        // The alphabet (s) is a sparse hash, so the following line generates
        // warnings.
        const charMatch = s[text.charAt(j - 1)]
        if (d === 0) { // First pass: exact match.
          rd[j] = ((rd[j + 1] << 1) | 1) & charMatch
        } else { // Subsequent passes: fuzzy match.
          rd[j] = (((rd[j + 1] << 1) | 1) & charMatch) |
                (((lastRd[j + 1] | lastRd[j]) << 1) | 1) |
                lastRd[j + 1]
        }
        if ((rd[j] & matchmask) !== 0) {
          const score = bitapScore(d, j - 1)
          // This match will almost certainly be better than any existing match.
          // But check anyway.
          if (score <= scoreThreshold) {
          // Told you so.
            scoreThreshold = score
            bestLoc = j - 1
            if (bestLoc > loc) {
            // When passing loc, don't exceed our current distance from loc.
              start = Math.max(1, 2 * loc - bestLoc)
            } else {
            // Already passed loc, downhill from here on in.
              break
            }
          }
        }
      }
      // No hope for a (better) match at greater error levels.
      if (bitapScore(d + 1, loc) > scoreThreshold) {
        break
      }
      lastRd = rd
    }
    return bestLoc
  }

  /**
   * Initialise the alphabet for the Bitap algorithm.
   * @param {string} pattern The text to encode.
   * @return {Record<string, number>} Hash of character locations.
   * @private
   */
  alphabet (pattern: string): Record<string, number> {
    const s: Record<string, number> = {}
    for (let i = 0; i < pattern.length; i++) {
      s[pattern.charAt(i)] = 0
    }
    for (let i = 0; i < pattern.length; i++) {
      s[pattern.charAt(i)] |= 1 << (pattern.length - i - 1)
    }
    return s
  }
}
