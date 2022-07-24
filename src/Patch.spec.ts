import test from 'tape'

import DiffMatchPatch from './index'
import Operation from './types/Operation'
import PatchObj from './PatchObj'

const dmp = new DiffMatchPatch()

// PATCH TEST FUNCTIONS

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

test('testPatchFromText', t => {
  t.isEquivalent(
    // @ts-expect-error
    dmp.patch_fromText(undefined),
    []
  )

  const strp = '@@ -21,18 +22,17 @@\n jump\n-s\n+ed\n  over \n-the\n+a\n %0Alaz\n'

  t.equals(
    dmp.patch_fromText(strp)[0].toString(),
    strp
  )

  t.equals(
    dmp.patch_fromText('@@ -1 +1 @@\n-a\n+b\n')[0].toString(),
    '@@ -1 +1 @@\n-a\n+b\n'
  )

  t.equals(
    dmp.patch_fromText('@@ -1,3 +0,0 @@\n-abc\n')[0].toString(),
    '@@ -1,3 +0,0 @@\n-abc\n'
  )

  t.equals(
    dmp.patch_fromText('@@ -0,0 +1,3 @@\n+abc\n')[0].toString(),
    '@@ -0,0 +1,3 @@\n+abc\n'
  )

  t.throws(() => dmp.patch_fromText('Bad\nPatch\n'))

  t.end()
})

test('testPatchToText', t => {
  let strp = '@@ -21,18 +22,17 @@\n jump\n-s\n+ed\n  over \n-the\n+a\n  laz\n'
  let p = dmp.patch_fromText(strp)
  t.equals(
    dmp.patch_toText(p),
    strp
  )

  strp = '@@ -1,9 +1,9 @@\n-f\n+F\n oo+fooba\n@@ -7,9 +7,9 @@\n obar\n-,\n+.\n  tes\n'
  p = dmp.patch_fromText(strp)
  t.equals(
    dmp.patch_toText(p),
    strp
  )

  t.end()
})

test('testPatchAddContext', t => {
  dmp.Patch_Margin = 4
  let p = dmp.patch_fromText('@@ -21,4 +21,10 @@\n-jump\n+somersault\n')[0]
  dmp.patch_addContext_(p, 'The quick brown fox jumps over the lazy dog.')
  t.equals(
    p.toString(),
    '@@ -17,12 +17,18 @@\n fox \n-jump\n+somersault\n s ov\n'
  )

  // Same, but not enough trailing context.
  p = dmp.patch_fromText('@@ -21,4 +21,10 @@\n-jump\n+somersault\n')[0]
  dmp.patch_addContext_(p, 'The quick brown fox jumps.')
  t.equals(
    p.toString(),
    '@@ -17,10 +17,16 @@\n fox \n-jump\n+somersault\n s.\n'
  )

  // Same, but not enough leading context.
  p = dmp.patch_fromText('@@ -3 +3,2 @@\n-e\n+at\n')[0]
  dmp.patch_addContext_(p, 'The quick brown fox jumps.')
  t.equals(
    p.toString(),
    '@@ -1,7 +1,8 @@\n Th\n-e\n+at\n  qui\n'
  )

  // Same, but with ambiguity.
  p = dmp.patch_fromText('@@ -3 +3,2 @@\n-e\n+at\n')[0]
  dmp.patch_addContext_(p, 'The quick brown fox jumps.  The quick brown fox crashes.')
  t.equals(
    p.toString(),
    '@@ -1,27 +1,28 @@\n Th\n-e\n+at\n  quick brown fox jumps. \n'
  )

  t.end()
})

test('testPatchMake', t => {
  // Null case.
  let patches = dmp.patch_make('', '')
  t.equals(
    dmp.patch_toText(patches),
    ''
  )

  let text1 = 'The quick brown fox jumps over the lazy dog.'
  let text2 = 'That quick brown fox jumped over a lazy dog.'
  // Text2+Text1 inputs.
  let expectedPatch = '@@ -1,8 +1,7 @@\n Th\n-at\n+e\n  qui\n@@ -21,17 +21,18 @@\n jump\n-ed\n+s\n  over \n-a\n+the\n  laz\n'
  // The second patch must be "-21,17 +21,18", not "-22,17 +21,18" due to rolling context.
  patches = dmp.patch_make(text2, text1)
  t.equals(
    dmp.patch_toText(patches),
    expectedPatch
  )

  // Text1+Text2 inputs.
  expectedPatch = '@@ -1,11 +1,12 @@\n Th\n-e\n+at\n  quick b\n@@ -22,18 +22,17 @@\n jump\n-s\n+ed\n  over \n-the\n+a\n  laz\n'
  patches = dmp.patch_make(text1, text2)
  t.equals(
    dmp.patch_toText(patches),
    expectedPatch
  )

  // Diff input.
  let diffs = dmp.diff_main(text1, text2, false)
  patches = dmp.patch_make(diffs)
  t.equals(
    dmp.patch_toText(patches),
    expectedPatch
  )

  // Text1+Diff inputs.
  patches = dmp.patch_make(text1, diffs)
  t.equals(
    dmp.patch_toText(patches),
    expectedPatch
  )

  // Text1+Text2+Diff inputs (deprecated).
  patches = dmp.patch_make(text1, text2, diffs)
  t.equals(
    dmp.patch_toText(patches),
    expectedPatch
  )

  // Character encoding.
  patches = dmp.patch_make('`1234567890-=[]\\;\',./', '~!@#$%^&*()_+{}|:"<>?')
  t.equals(
    dmp.patch_toText(patches),
    '@@ -1,21 +1,21 @@\n-%601234567890-=%5B%5D%5C;\',./\n+~!@#$%25%5E&*()_+%7B%7D%7C:%22%3C%3E?\n'
  )

  // Character decoding.
  diffs = [[Operation.DIFF_DELETE, '`1234567890-=[]\\;\',./'], [Operation.DIFF_INSERT, '~!@#$%^&*()_+{}|:"<>?']]
  t.isEquivalent(
    dmp.patch_fromText('@@ -1,21 +1,21 @@\n-%601234567890-=%5B%5D%5C;\',./\n+~!@#$%25%5E&*()_+%7B%7D%7C:%22%3C%3E?\n')[0].diffs,
    diffs
  )

  // Long string with repeats.
  text1 = ''
  for (let x = 0; x < 100; x++) {
    text1 += 'abcdef'
  }
  text2 = text1 + '123'
  expectedPatch = '@@ -573,28 +573,31 @@\n cdefabcdefabcdefabcdefabcdef\n+123\n'
  patches = dmp.patch_make(text1, text2)
  t.equals(
    dmp.patch_toText(patches),
    expectedPatch
  )

  // Test null inputs.
  // @ts-expect-error
  t.throws(() => dmp.patch_make(null))

  t.end()
})

test('testPatchSplitMax', t => {
  // Assumes that dmp.Match_MaxBits is 32.
  let patches = dmp.patch_make('abcdefghijklmnopqrstuvwxyz01234567890', 'XabXcdXefXghXijXklXmnXopXqrXstXuvXwxXyzX01X23X45X67X89X0')
  dmp.patch_splitMax(patches)
  t.equals(
    dmp.patch_toText(patches),
    '@@ -1,32 +1,46 @@\n+X\n ab\n+X\n cd\n+X\n ef\n+X\n gh\n+X\n ij\n+X\n kl\n+X\n mn\n+X\n op\n+X\n qr\n+X\n st\n+X\n uv\n+X\n wx\n+X\n yz\n+X\n 012345\n@@ -25,13 +39,18 @@\n zX01\n+X\n 23\n+X\n 45\n+X\n 67\n+X\n 89\n+X\n 0\n'
  )

  patches = dmp.patch_make('abcdef1234567890123456789012345678901234567890123456789012345678901234567890uvwxyz', 'abcdefuvwxyz')
  const oldToText = dmp.patch_toText(patches)
  dmp.patch_splitMax(patches)
  t.equals(
    dmp.patch_toText(patches),
    oldToText
  )

  patches = dmp.patch_make('1234567890123456789012345678901234567890123456789012345678901234567890', 'abc')
  dmp.patch_splitMax(patches)
  t.equals(
    dmp.patch_toText(patches),
    '@@ -1,32 +1,4 @@\n-1234567890123456789012345678\n 9012\n@@ -29,32 +1,4 @@\n-9012345678901234567890123456\n 7890\n@@ -57,14 +1,3 @@\n-78901234567890\n+abc\n'
  )

  patches = dmp.patch_make('abcdefghij , h : 0 , t : 1 abcdefghij , h : 0 , t : 1 abcdefghij , h : 0 , t : 1', 'abcdefghij , h : 1 , t : 1 abcdefghij , h : 1 , t : 1 abcdefghij , h : 0 , t : 1')
  dmp.patch_splitMax(patches)
  t.equals(
    dmp.patch_toText(patches),
    '@@ -2,32 +2,32 @@\n bcdefghij , h : \n-0\n+1\n  , t : 1 abcdef\n@@ -29,32 +29,32 @@\n bcdefghij , h : \n-0\n+1\n  , t : 1 abcdef\n'
  )

  t.end()
})

test('testPatchAddPadding', t => {
  // Both edges full.
  let patches = dmp.patch_make('', 'test')
  t.equals(
    dmp.patch_toText(patches),
    '@@ -0,0 +1,4 @@\n+test\n'
  )
  dmp.patch_addPadding(patches)
  t.equals(
    dmp.patch_toText(patches),
    '@@ -1,8 +1,12 @@\n %01%02%03%04\n+test\n %01%02%03%04\n'
  )

  // Both edges partial.
  patches = dmp.patch_make('XY', 'XtestY')
  t.equals(
    dmp.patch_toText(patches),
    '@@ -1,2 +1,6 @@\n X\n+test\n Y\n'
  )
  dmp.patch_addPadding(patches)
  t.equals(
    dmp.patch_toText(patches),
    '@@ -2,8 +2,12 @@\n %02%03%04X\n+test\n Y%01%02%03\n'
  )

  // Both edges none.
  patches = dmp.patch_make('XXXXYYYY', 'XXXXtestYYYY')
  t.equals(
    dmp.patch_toText(patches),
    '@@ -1,8 +1,12 @@\n XXXX\n+test\n YYYY\n'
  )
  dmp.patch_addPadding(patches)
  t.equals(
    dmp.patch_toText(patches),
    '@@ -5,8 +5,12 @@\n XXXX\n+test\n YYYY\n'
  )

  t.end()
})

test('testPatchApply', t => {
  dmp.Match_Distance = 1000
  dmp.Match_Threshold = 0.5
  dmp.Patch_DeleteThreshold = 0.5
  // Null case.
  let patches = dmp.patch_make('', '')
  let results = dmp.patch_apply(patches, 'Hello world.')
  t.isEquivalent(
    results,
    ['Hello world.', []]
  )

  // Exact match.
  patches = dmp.patch_make('The quick brown fox jumps over the lazy dog.', 'That quick brown fox jumped over a lazy dog.')
  results = dmp.patch_apply(patches, 'The quick brown fox jumps over the lazy dog.')
  t.isEquivalent(
    results,
    ['That quick brown fox jumped over a lazy dog.', [true, true]]
  )

  // Partial match.
  results = dmp.patch_apply(patches, 'The quick red rabbit jumps over the tired tiger.')
  t.isEquivalent(
    results,
    ['That quick red rabbit jumped over a tired tiger.', [true, true]]
  )

  // Failed match.
  results = dmp.patch_apply(patches, 'I am the very model of a modern major general.')
  t.isEquivalent(
    results,
    ['I am the very model of a modern major general.', [false, false]]
  )

  // Big delete, small change.
  patches = dmp.patch_make('x1234567890123456789012345678901234567890123456789012345678901234567890y', 'xabcy')
  results = dmp.patch_apply(patches, 'x123456789012345678901234567890-----++++++++++-----123456789012345678901234567890y')
  t.isEquivalent(
    results,
    ['xabcy', [true, true]]
  )

  // Big delete, big change 1.
  patches = dmp.patch_make('x1234567890123456789012345678901234567890123456789012345678901234567890y', 'xabcy')
  results = dmp.patch_apply(patches, 'x12345678901234567890---------------++++++++++---------------12345678901234567890y')
  t.isEquivalent(
    results,
    ['xabc12345678901234567890---------------++++++++++---------------12345678901234567890y', [false, true]]
  )

  // Big delete, big change 2.
  dmp.Patch_DeleteThreshold = 0.6
  patches = dmp.patch_make('x1234567890123456789012345678901234567890123456789012345678901234567890y', 'xabcy')
  results = dmp.patch_apply(patches, 'x12345678901234567890---------------++++++++++---------------12345678901234567890y')
  t.isEquivalent(
    results,
    ['xabcy', [true, true]]
  )
  dmp.Patch_DeleteThreshold = 0.5

  // Compensate for failed patch.
  dmp.Match_Threshold = 0.0
  dmp.Match_Distance = 0
  patches = dmp.patch_make('abcdefghijklmnopqrstuvwxyz--------------------1234567890', 'abcXXXXXXXXXXdefghijklmnopqrstuvwxyz--------------------1234567YYYYYYYYYY890')
  results = dmp.patch_apply(patches, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ--------------------1234567890')
  t.isEquivalent(
    results,
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZ--------------------1234567YYYYYYYYYY890', [false, true]]
  )
  dmp.Match_Threshold = 0.5
  dmp.Match_Distance = 1000

  // No side effects.
  patches = dmp.patch_make('', 'test')
  let patchstr = dmp.patch_toText(patches)
  dmp.patch_apply(patches, '')
  t.equals(
    dmp.patch_toText(patches),
    patchstr
  )

  // No side effects with major delete.
  patches = dmp.patch_make('The quick brown fox jumps over the lazy dog.', 'Woof')
  patchstr = dmp.patch_toText(patches)
  dmp.patch_apply(patches, 'The quick brown fox jumps over the lazy dog.')
  t.equals(
    dmp.patch_toText(patches),
    patchstr
  )

  // Edge exact match.
  patches = dmp.patch_make('', 'test')
  results = dmp.patch_apply(patches, '')
  t.isEquivalent(
    results,
    ['test', [true]]
  )

  // Near edge exact match.
  patches = dmp.patch_make('XY', 'XtestY')
  results = dmp.patch_apply(patches, 'XY')
  t.isEquivalent(
    results,
    ['XtestY', [true]]
  )

  // Edge partial match.
  patches = dmp.patch_make('y', 'y123')
  results = dmp.patch_apply(patches, 'x')
  t.isEquivalent(
    results,
    ['x123', [true]]
  )

  t.end()
})
