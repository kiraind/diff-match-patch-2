import Operation from './types/Operation'
import Diff from './types/Diff'

/**
 * Class representing one patch operation.
 */
export default class PatchObj {
  diffs: Diff[]
  start1: number | null
  start2: number | null
  length1: number
  length2: number

  constructor () {
    this.diffs = []
    this.start1 = null
    this.start2 = null
    this.length1 = 0
    this.length2 = 0
  }

  /**
   * Emulate GNU diff's format.
   * Header: @@ -382,8 +481,9 @@
   * Indices are printed as 1-based, not 0-based.
   * @return {string} The GNU diff string.
   */
  toString (): string {
    if (this.start1 === null || this.start2 === null) {
      throw new Error('PatchObj.toString: this.start1 or this.start2 is null')
    }

    let coords1: string, coords2: string
    if (this.length1 === 0) {
      coords1 = `${this.start1},0`
    } else if (this.length1 === 1) {
      coords1 = (this.start1 + 1).toString()
    } else {
      coords1 = `${this.start1 + 1},${this.length1}`
    }
    if (this.length2 === 0) {
      coords2 = `${this.start2},0`
    } else if (this.length2 === 1) {
      coords2 = (this.start2 + 1).toString()
    } else {
      coords2 = `${this.start2 + 1},${this.length2}`
    }
    const text = [`@@ -${coords1} +${coords2} @@\n`]
    let op
    // Escape the body of the patch with %xx notation.
    for (let x = 0; x < this.diffs.length; x++) {
      switch (this.diffs[x][0]) {
        case Operation.DIFF_INSERT:
          op = '+'
          break
        case Operation.DIFF_DELETE:
          op = '-'
          break
        case Operation.DIFF_EQUAL:
          op = ' '
          break
      }
      text[x + 1] = op + encodeURI(this.diffs[x][1]) + '\n'
    }
    return text.join('').replace(/%20/g, ' ')
  }
}
