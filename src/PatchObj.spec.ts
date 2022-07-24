import test from 'tape'

import PatchObj from './PatchObj'
import Operation from './types/Operation'

test('testPatchObj', t => {
  // PatchObj Object.
  const p = new PatchObj()
  p.start1 = 20
  p.start2 = 21
  p.length1 = 18
  p.length2 = 17
  p.diffs = [[Operation.DIFF_EQUAL, 'jump'], [Operation.DIFF_DELETE, 's'], [Operation.DIFF_INSERT, 'ed'], [Operation.DIFF_EQUAL, ' over '], [Operation.DIFF_DELETE, 'the'], [Operation.DIFF_INSERT, 'a'], [Operation.DIFF_EQUAL, '\nlaz']]
  const strp = p.toString()

  t.equals(
    strp,
    '@@ -21,18 +22,17 @@\n jump\n-s\n+ed\n  over \n-the\n+a\n %0Alaz\n'
  )

  t.end()
})
