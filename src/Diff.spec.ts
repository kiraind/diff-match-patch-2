import test from 'tape'
import DiffObj from './types/DiffObj'

import DiffMatchPatch from './index'
import Operation from './types/Operation'

function rebuildTexts (diffs: DiffObj[]): [string, string] {
  // Construct the two texts which made up the diff originally.
  let text1 = ''
  let text2 = ''
  for (let x = 0; x < diffs.length; x++) {
    if (diffs[x][0] !== Operation.DIFF_INSERT) {
      text1 += diffs[x][1]
    }
    if (diffs[x][0] !== Operation.DIFF_DELETE) {
      text2 += diffs[x][1]
    }
  }
  return [text1, text2]
}

const dmp = new DiffMatchPatch()

// DIFF TEST FUNCTIONS

test('testDiffCommonPrefix', t => {
  // Detect any common prefix.
  // Null case.
  t.equals(
    dmp.diff.commonPrefix('abc', 'xyz'),
    0
  )

  // Non-null case.
  t.equals(
    dmp.diff.commonPrefix('1234abcdef', '1234xyz'),
    4
  )

  // Whole case.
  t.equals(
    dmp.diff.commonPrefix('1234', '1234xyz'),
    4
  )

  t.end()
})

test('testDiffCommonSuffix', t => {
  // Detect any common suffix.
  // Null case.
  t.equals(
    dmp.diff.commonSuffix('abc', 'xyz'),
    0
  )

  // Non-null case.
  t.equals(
    dmp.diff.commonSuffix('abcdef1234', 'xyz1234'),
    4
  )

  // Whole case.
  t.equals(
    dmp.diff.commonSuffix('1234', 'xyz1234'),
    4
  )

  t.end()
})

test('testDiffCommonOverlap', t => {
  // Detect any suffix/prefix overlap.
  // Null case.
  t.equals(
    dmp.diff.commonOverlap('', 'abcd'),
    0
  )

  // Whole case.
  t.equals(
    dmp.diff.commonOverlap('abc', 'abcd'),
    3
  )

  // No overlap.
  t.equals(
    dmp.diff.commonOverlap('123456', 'abcd'),
    0
  )

  // Overlap.
  t.equals(
    3,
    dmp.diff.commonOverlap('123456xxx', 'xxxabcd')
  )

  // Unicode.
  // Some overly clever languages (C#) may treat ligatures as equal to their
  // component letters.  E.g. U+FB01 == 'fi'
  t.equals(
    dmp.diff.commonOverlap('fi', '\ufb01i'),
    0
  )

  t.end()
})

test('testDiffHalfMatch', t => {
  // Detect a halfmatch.
  dmp.diff.timeout = 1
  // No match.
  t.equals(
    dmp.diff.halfMatch('1234567890', 'abcdef'),
    null
  )

  t.equals(
    dmp.diff.halfMatch('12345', '23'),
    null
  )

  // Single Match.
  t.isEquivalent(
    dmp.diff.halfMatch('1234567890', 'a345678z'),
    ['12', '90', 'a', 'z', '345678']
  )

  t.isEquivalent(
    dmp.diff.halfMatch('a345678z', '1234567890'),
    ['a', 'z', '12', '90', '345678']
  )

  t.isEquivalent(
    dmp.diff.halfMatch('abc56789z', '1234567890'),
    ['abc', 'z', '1234', '0', '56789']
  )

  t.isEquivalent(
    dmp.diff.halfMatch('a23456xyz', '1234567890'),
    ['a', 'xyz', '1', '7890', '23456']
  )

  // Multiple Matches.
  t.isEquivalent(
    dmp.diff.halfMatch('121231234123451234123121', 'a1234123451234z'),
    ['12123', '123121', 'a', 'z', '1234123451234']
  )

  t.isEquivalent(
    dmp.diff.halfMatch('x-=-=-=-=-=-=-=-=-=-=-=-=', 'xx-=-=-=-=-=-=-='),
    ['', '-=-=-=-=-=', 'x', '', 'x-=-=-=-=-=-=-=']
  )

  t.isEquivalent(
    dmp.diff.halfMatch('-=-=-=-=-=-=-=-=-=-=-=-=y', '-=-=-=-=-=-=-=yy'),
    ['-=-=-=-=-=', '', '', 'y', '-=-=-=-=-=-=-=y']
  )

  // Non-optimal halfmatch.
  // Optimal diff would be -q+x=H-i+e=lloHe+Hu=llo-Hew+y not -qHillo+x=HelloHe-w+Hulloy
  t.isEquivalent(
    dmp.diff.halfMatch('qHilloHelloHew', 'xHelloHeHulloy'),
    ['qHillo', 'w', 'x', 'Hulloy', 'HelloHe']
  )

  // Optimal no halfmatch.
  dmp.diff.timeout = 0
  t.equals(
    dmp.diff.halfMatch('qHilloHelloHew', 'xHelloHeHulloy'),
    null
  )

  t.end()
})

test('testDiffLinesToChars', t => {
  // Convert lines down to characters.
  t.isEquivalent(
    dmp.diff.linesToChars('alpha\nbeta\nalpha\n', 'beta\nalpha\nbeta\n'),
    { chars1: '\x01\x02\x01', chars2: '\x02\x01\x02', lineArray: ['', 'alpha\n', 'beta\n'] }
  )

  t.isEquivalent(
    dmp.diff.linesToChars('', 'alpha\r\nbeta\r\n\r\n\r\n'),
    { chars1: '', chars2: '\x01\x02\x03\x03', lineArray: ['', 'alpha\r\n', 'beta\r\n', '\r\n'] }
  )

  t.isEquivalent(
    dmp.diff.linesToChars('a', 'b'),
    { chars1: '\x01', chars2: '\x02', lineArray: ['', 'a', 'b'] }
  )

  // More than 256 to reveal any 8-bit limitations.
  const n = 300
  const lineList = []
  const charList = []
  for (let i = 1; i < n + 1; i++) {
    lineList[i - 1] = i.toString() + '\n'
    charList[i - 1] = String.fromCharCode(i)
  }
  t.equals(
    lineList.length,
    n
  )

  const lines = lineList.join('')
  const chars = charList.join('')
  t.equals(
    chars.length,
    n
  )

  lineList.unshift('')
  t.isEquivalent(
    dmp.diff.linesToChars(lines, ''),
    { chars1: chars, chars2: '', lineArray: lineList }
  )

  t.end()
})

test('testDiffCharsToLines', t => {
  // Convert chars up to lines.
  let diffs: DiffObj[] = [[Operation.DIFF_EQUAL, '\x01\x02\x01'], [Operation.DIFF_INSERT, '\x02\x01\x02']]
  dmp.diff.charsToLines(diffs, ['', 'alpha\n', 'beta\n'])
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_EQUAL, 'alpha\nbeta\nalpha\n'], [Operation.DIFF_INSERT, 'beta\nalpha\nbeta\n']]
  )

  // More than 256 to reveal any 8-bit limitations.
  const n = 300
  let lineList = []
  const charList = []
  for (let i = 1; i < n + 1; i++) {
    lineList[i - 1] = i.toString() + '\n'
    charList[i - 1] = String.fromCharCode(i)
  }
  t.equals(
    lineList.length,
    n
  )

  const lines = lineList.join('')
  let chars = charList.join('')
  t.equals(
    chars.length,
    n
  )

  lineList.unshift('')
  diffs = [[Operation.DIFF_DELETE, chars]]
  dmp.diff.charsToLines(diffs, lineList)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, lines]]
  )

  // More than 65536 to verify any 16-bit limitation.
  lineList = []
  for (let i = 0; i < 66000; i++) {
    lineList[i] = i.toString() + '\n'
  }
  chars = lineList.join('')
  const results = dmp.diff.linesToChars(chars, '')
  diffs = [[Operation.DIFF_INSERT, results.chars1]]
  dmp.diff.charsToLines(diffs, results.lineArray)
  t.equals(
    diffs[0][1],
    chars
  )

  t.end()
})

test('testDiffCleanupMerge', t => {
  // Cleanup a messy diff.
  // Null case.
  let diffs: DiffObj[] = []
  dmp.diff.cleanupMerge(diffs)
  t.isEquivalent(diffs, [])

  // No change case.
  diffs = [[Operation.DIFF_EQUAL, 'a'], [Operation.DIFF_DELETE, 'b'], [Operation.DIFF_INSERT, 'c']]
  dmp.diff.cleanupMerge(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_EQUAL, 'a'], [Operation.DIFF_DELETE, 'b'], [Operation.DIFF_INSERT, 'c']]
  )

  // Merge equalities.
  diffs = [[Operation.DIFF_EQUAL, 'a'], [Operation.DIFF_EQUAL, 'b'], [Operation.DIFF_EQUAL, 'c']]
  dmp.diff.cleanupMerge(diffs)
  t.isEquivalent(diffs, [[Operation.DIFF_EQUAL, 'abc']])

  // Merge deletions.
  diffs = [[Operation.DIFF_DELETE, 'a'], [Operation.DIFF_DELETE, 'b'], [Operation.DIFF_DELETE, 'c']]
  dmp.diff.cleanupMerge(diffs)
  t.isEquivalent(diffs, [[Operation.DIFF_DELETE, 'abc']])

  // Merge insertions.
  diffs = [[Operation.DIFF_INSERT, 'a'], [Operation.DIFF_INSERT, 'b'], [Operation.DIFF_INSERT, 'c']]
  dmp.diff.cleanupMerge(diffs)
  t.isEquivalent(diffs, [[Operation.DIFF_INSERT, 'abc']])

  // Merge interweave.
  diffs = [[Operation.DIFF_DELETE, 'a'], [Operation.DIFF_INSERT, 'b'], [Operation.DIFF_DELETE, 'c'], [Operation.DIFF_INSERT, 'd'], [Operation.DIFF_EQUAL, 'e'], [Operation.DIFF_EQUAL, 'f']]
  dmp.diff.cleanupMerge(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'ac'], [Operation.DIFF_INSERT, 'bd'], [Operation.DIFF_EQUAL, 'ef']]
  )

  // Prefix and suffix detection.
  diffs = [[Operation.DIFF_DELETE, 'a'], [Operation.DIFF_INSERT, 'abc'], [Operation.DIFF_DELETE, 'dc']]
  dmp.diff.cleanupMerge(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_EQUAL, 'a'], [Operation.DIFF_DELETE, 'd'], [Operation.DIFF_INSERT, 'b'], [Operation.DIFF_EQUAL, 'c']]
  )

  // Prefix and suffix detection with equalities.
  diffs = [[Operation.DIFF_EQUAL, 'x'], [Operation.DIFF_DELETE, 'a'], [Operation.DIFF_INSERT, 'abc'], [Operation.DIFF_DELETE, 'dc'], [Operation.DIFF_EQUAL, 'y']]
  dmp.diff.cleanupMerge(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_EQUAL, 'xa'], [Operation.DIFF_DELETE, 'd'], [Operation.DIFF_INSERT, 'b'], [Operation.DIFF_EQUAL, 'cy']]
  )

  // Slide edit left.
  diffs = [[Operation.DIFF_EQUAL, 'a'], [Operation.DIFF_INSERT, 'ba'], [Operation.DIFF_EQUAL, 'c']]
  dmp.diff.cleanupMerge(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_INSERT, 'ab'], [Operation.DIFF_EQUAL, 'ac']]
  )

  // Slide edit right.
  diffs = [[Operation.DIFF_EQUAL, 'c'], [Operation.DIFF_INSERT, 'ab'], [Operation.DIFF_EQUAL, 'a']]
  dmp.diff.cleanupMerge(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_EQUAL, 'ca'], [Operation.DIFF_INSERT, 'ba']]
  )

  // Slide edit left recursive.
  diffs = [[Operation.DIFF_EQUAL, 'a'], [Operation.DIFF_DELETE, 'b'], [Operation.DIFF_EQUAL, 'c'], [Operation.DIFF_DELETE, 'ac'], [Operation.DIFF_EQUAL, 'x']]
  dmp.diff.cleanupMerge(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'abc'], [Operation.DIFF_EQUAL, 'acx']]
  )

  // Slide edit right recursive.
  diffs = [[Operation.DIFF_EQUAL, 'x'], [Operation.DIFF_DELETE, 'ca'], [Operation.DIFF_EQUAL, 'c'], [Operation.DIFF_DELETE, 'b'], [Operation.DIFF_EQUAL, 'a']]
  dmp.diff.cleanupMerge(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_EQUAL, 'xca'], [Operation.DIFF_DELETE, 'cba']]
  )

  // Empty merge.
  diffs = [[Operation.DIFF_DELETE, 'b'], [Operation.DIFF_INSERT, 'ab'], [Operation.DIFF_EQUAL, 'c']]
  dmp.diff.cleanupMerge(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_INSERT, 'a'], [Operation.DIFF_EQUAL, 'bc']]
  )

  // Empty equality.
  diffs = [[Operation.DIFF_EQUAL, ''], [Operation.DIFF_INSERT, 'a'], [Operation.DIFF_EQUAL, 'b']]
  dmp.diff.cleanupMerge(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_INSERT, 'a'], [Operation.DIFF_EQUAL, 'b']]
  )

  t.end()
})

test('testDiffCleanupSemanticLossless', t => {
  // Slide diffs to match logical boundaries.
  // Null case.
  let diffs: DiffObj[] = []
  dmp.diff.cleanupSemanticLossless(diffs)
  t.isEquivalent(diffs, [])

  // Blank lines.
  diffs = [[Operation.DIFF_EQUAL, 'AAA\r\n\r\nBBB'], [Operation.DIFF_INSERT, '\r\nDDD\r\n\r\nBBB'], [Operation.DIFF_EQUAL, '\r\nEEE']]
  dmp.diff.cleanupSemanticLossless(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_EQUAL, 'AAA\r\n\r\n'], [Operation.DIFF_INSERT, 'BBB\r\nDDD\r\n\r\n'], [Operation.DIFF_EQUAL, 'BBB\r\nEEE']]
  )

  // Line boundaries.
  diffs = [[Operation.DIFF_EQUAL, 'AAA\r\nBBB'], [Operation.DIFF_INSERT, ' DDD\r\nBBB'], [Operation.DIFF_EQUAL, ' EEE']]
  dmp.diff.cleanupSemanticLossless(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_EQUAL, 'AAA\r\n'], [Operation.DIFF_INSERT, 'BBB DDD\r\n'], [Operation.DIFF_EQUAL, 'BBB EEE']]
  )

  // Word boundaries.
  diffs = [[Operation.DIFF_EQUAL, 'The c'], [Operation.DIFF_INSERT, 'ow and the c'], [Operation.DIFF_EQUAL, 'at.']]
  dmp.diff.cleanupSemanticLossless(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_EQUAL, 'The '], [Operation.DIFF_INSERT, 'cow and the '], [Operation.DIFF_EQUAL, 'cat.']]
  )

  // Alphanumeric boundaries.
  diffs = [[Operation.DIFF_EQUAL, 'The-c'], [Operation.DIFF_INSERT, 'ow-and-the-c'], [Operation.DIFF_EQUAL, 'at.']]
  dmp.diff.cleanupSemanticLossless(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_EQUAL, 'The-'], [Operation.DIFF_INSERT, 'cow-and-the-'], [Operation.DIFF_EQUAL, 'cat.']]
  )

  // Hitting the start.
  diffs = [[Operation.DIFF_EQUAL, 'a'], [Operation.DIFF_DELETE, 'a'], [Operation.DIFF_EQUAL, 'ax']]
  dmp.diff.cleanupSemanticLossless(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'a'], [Operation.DIFF_EQUAL, 'aax']]
  )

  // Hitting the end.
  diffs = [[Operation.DIFF_EQUAL, 'xa'], [Operation.DIFF_DELETE, 'a'], [Operation.DIFF_EQUAL, 'a']]
  dmp.diff.cleanupSemanticLossless(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_EQUAL, 'xaa'], [Operation.DIFF_DELETE, 'a']]
  )

  // Sentence boundaries.
  diffs = [[Operation.DIFF_EQUAL, 'The xxx. The '], [Operation.DIFF_INSERT, 'zzz. The '], [Operation.DIFF_EQUAL, 'yyy.']]
  dmp.diff.cleanupSemanticLossless(diffs)
  t.isEquivalent(
    [[Operation.DIFF_EQUAL, 'The xxx.'], [Operation.DIFF_INSERT, ' The zzz.'], [Operation.DIFF_EQUAL, ' The yyy.']],
    diffs
  )

  t.end()
})

test('testDiffCleanupSemantic', t => {
  // Cleanup semantically trivial equalities.
  // Null case.
  let diffs: DiffObj[] = []
  dmp.diff.cleanupSemantic(diffs)
  t.isEquivalent(diffs, [])

  // No elimination #1.
  diffs = [[Operation.DIFF_DELETE, 'ab'], [Operation.DIFF_INSERT, 'cd'], [Operation.DIFF_EQUAL, '12'], [Operation.DIFF_DELETE, 'e']]
  dmp.diff.cleanupSemantic(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'ab'], [Operation.DIFF_INSERT, 'cd'], [Operation.DIFF_EQUAL, '12'], [Operation.DIFF_DELETE, 'e']]
  )

  // No elimination #2.
  diffs = [[Operation.DIFF_DELETE, 'abc'], [Operation.DIFF_INSERT, 'ABC'], [Operation.DIFF_EQUAL, '1234'], [Operation.DIFF_DELETE, 'wxyz']]
  dmp.diff.cleanupSemantic(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'abc'], [Operation.DIFF_INSERT, 'ABC'], [Operation.DIFF_EQUAL, '1234'], [Operation.DIFF_DELETE, 'wxyz']]
  )

  // Simple elimination.
  diffs = [[Operation.DIFF_DELETE, 'a'], [Operation.DIFF_EQUAL, 'b'], [Operation.DIFF_DELETE, 'c']]
  dmp.diff.cleanupSemantic(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'abc'], [Operation.DIFF_INSERT, 'b']]
  )

  // Backpass elimination.
  diffs = [[Operation.DIFF_DELETE, 'ab'], [Operation.DIFF_EQUAL, 'cd'], [Operation.DIFF_DELETE, 'e'], [Operation.DIFF_EQUAL, 'f'], [Operation.DIFF_INSERT, 'g']]
  dmp.diff.cleanupSemantic(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'abcdef'], [Operation.DIFF_INSERT, 'cdfg']]
  )

  // Multiple eliminations.
  diffs = [[Operation.DIFF_INSERT, '1'], [Operation.DIFF_EQUAL, 'A'], [Operation.DIFF_DELETE, 'B'], [Operation.DIFF_INSERT, '2'], [Operation.DIFF_EQUAL, '_'], [Operation.DIFF_INSERT, '1'], [Operation.DIFF_EQUAL, 'A'], [Operation.DIFF_DELETE, 'B'], [Operation.DIFF_INSERT, '2']]
  dmp.diff.cleanupSemantic(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'AB_AB'], [Operation.DIFF_INSERT, '1A2_1A2']]
  )

  // Word boundaries.
  diffs = [[Operation.DIFF_EQUAL, 'The c'], [Operation.DIFF_DELETE, 'ow and the c'], [Operation.DIFF_EQUAL, 'at.']]
  dmp.diff.cleanupSemantic(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_EQUAL, 'The '], [Operation.DIFF_DELETE, 'cow and the '], [Operation.DIFF_EQUAL, 'cat.']]
  )

  // No overlap elimination.
  diffs = [[Operation.DIFF_DELETE, 'abcxx'], [Operation.DIFF_INSERT, 'xxdef']]
  dmp.diff.cleanupSemantic(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'abcxx'], [Operation.DIFF_INSERT, 'xxdef']]
  )

  // Overlap elimination.
  diffs = [[Operation.DIFF_DELETE, 'abcxxx'], [Operation.DIFF_INSERT, 'xxxdef']]
  dmp.diff.cleanupSemantic(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'abc'], [Operation.DIFF_EQUAL, 'xxx'], [Operation.DIFF_INSERT, 'def']]
  )

  // Reverse overlap elimination.
  diffs = [[Operation.DIFF_DELETE, 'xxxabc'], [Operation.DIFF_INSERT, 'defxxx']]
  dmp.diff.cleanupSemantic(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_INSERT, 'def'], [Operation.DIFF_EQUAL, 'xxx'], [Operation.DIFF_DELETE, 'abc']]
  )

  // Two overlap eliminations.
  diffs = [[Operation.DIFF_DELETE, 'abcd1212'], [Operation.DIFF_INSERT, '1212efghi'], [Operation.DIFF_EQUAL, '----'], [Operation.DIFF_DELETE, 'A3'], [Operation.DIFF_INSERT, '3BC']]
  dmp.diff.cleanupSemantic(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'abcd'], [Operation.DIFF_EQUAL, '1212'], [Operation.DIFF_INSERT, 'efghi'], [Operation.DIFF_EQUAL, '----'], [Operation.DIFF_DELETE, 'A'], [Operation.DIFF_EQUAL, '3'], [Operation.DIFF_INSERT, 'BC']]
  )

  t.end()
})

test('testDiffCleanupEfficiency', t => {
  // Cleanup operationally trivial equalities.
  dmp.diff.editCost = 4
  // Null case.
  let diffs: DiffObj[] = []
  dmp.diff.cleanupEfficiency(diffs)
  t.isEquivalent(diffs, [])

  // No elimination.
  diffs = [[Operation.DIFF_DELETE, 'ab'], [Operation.DIFF_INSERT, '12'], [Operation.DIFF_EQUAL, 'wxyz'], [Operation.DIFF_DELETE, 'cd'], [Operation.DIFF_INSERT, '34']]
  dmp.diff.cleanupEfficiency(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'ab'], [Operation.DIFF_INSERT, '12'], [Operation.DIFF_EQUAL, 'wxyz'], [Operation.DIFF_DELETE, 'cd'], [Operation.DIFF_INSERT, '34']]
  )

  // Four-edit elimination.
  diffs = [[Operation.DIFF_DELETE, 'ab'], [Operation.DIFF_INSERT, '12'], [Operation.DIFF_EQUAL, 'xyz'], [Operation.DIFF_DELETE, 'cd'], [Operation.DIFF_INSERT, '34']]
  dmp.diff.cleanupEfficiency(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'abxyzcd'], [Operation.DIFF_INSERT, '12xyz34']]
  )

  // Three-edit elimination.
  diffs = [[Operation.DIFF_INSERT, '12'], [Operation.DIFF_EQUAL, 'x'], [Operation.DIFF_DELETE, 'cd'], [Operation.DIFF_INSERT, '34']]
  dmp.diff.cleanupEfficiency(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'xcd'], [Operation.DIFF_INSERT, '12x34']]
  )

  // Backpass elimination.
  diffs = [[Operation.DIFF_DELETE, 'ab'], [Operation.DIFF_INSERT, '12'], [Operation.DIFF_EQUAL, 'xy'], [Operation.DIFF_INSERT, '34'], [Operation.DIFF_EQUAL, 'z'], [Operation.DIFF_DELETE, 'cd'], [Operation.DIFF_INSERT, '56']]
  dmp.diff.cleanupEfficiency(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'abxyzcd'], [Operation.DIFF_INSERT, '12xy34z56']]
  )

  // High cost elimination.
  dmp.diff.editCost = 5
  diffs = [[Operation.DIFF_DELETE, 'ab'], [Operation.DIFF_INSERT, '12'], [Operation.DIFF_EQUAL, 'wxyz'], [Operation.DIFF_DELETE, 'cd'], [Operation.DIFF_INSERT, '34']]
  dmp.diff.cleanupEfficiency(diffs)
  t.isEquivalent(
    diffs,
    [[Operation.DIFF_DELETE, 'abwxyzcd'], [Operation.DIFF_INSERT, '12wxyz34']]
  )
  dmp.diff.editCost = 4

  t.end()
})

test('testDiffPrettyHtml', t => {
  // Pretty print.
  const diffs: DiffObj[] = [[Operation.DIFF_EQUAL, 'a\n'], [Operation.DIFF_DELETE, '<B>b</B>'], [Operation.DIFF_INSERT, 'c&d']]
  t.equals(
    dmp.diff.prettyHtml(diffs),
    '<span>a&para;<br></span><del style="background:#ffe6e6;">&lt;B&gt;b&lt;/B&gt;</del><ins style="background:#e6ffe6;">c&amp;d</ins>'
  )

  t.end()
})

test('testDiffText', t => {
  // Compute the source and destination texts.
  const diffs: DiffObj[] = [[Operation.DIFF_EQUAL, 'jump'], [Operation.DIFF_DELETE, 's'], [Operation.DIFF_INSERT, 'ed'], [Operation.DIFF_EQUAL, ' over '], [Operation.DIFF_DELETE, 'the'], [Operation.DIFF_INSERT, 'a'], [Operation.DIFF_EQUAL, ' lazy']]
  t.equals(
    dmp.diff.text1(diffs),
    'jumps over the lazy'
  )

  t.equals(
    dmp.diff.text2(diffs),
    'jumped over a lazy'
  )

  t.end()
})

test('testDiffDelta', t => {
  // Convert a diff into delta string.
  let diffs: DiffObj[] = [[Operation.DIFF_EQUAL, 'jump'], [Operation.DIFF_DELETE, 's'], [Operation.DIFF_INSERT, 'ed'], [Operation.DIFF_EQUAL, ' over '], [Operation.DIFF_DELETE, 'the'], [Operation.DIFF_INSERT, 'a'], [Operation.DIFF_EQUAL, ' lazy'], [Operation.DIFF_INSERT, 'old dog']]
  let text1 = dmp.diff.text1(diffs)
  t.equals(text1, 'jumps over the lazy')

  let delta = dmp.diff.toDelta(diffs)
  t.equals(delta, '=4\t-1\t+ed\t=6\t-3\t+a\t=5\t+old dog')

  // Convert delta string into a diff.
  t.isEquivalent(dmp.diff.fromDelta(text1, delta), diffs)

  // Generates error (19 != 20).
  t.throws(() => dmp.diff.fromDelta(text1 + 'x', delta))

  // Generates error (19 != 18).
  t.throws(() => dmp.diff.fromDelta(text1.substring(1), delta))

  // Generates error (%c3%xy invalid Unicode).
  t.throws(() => dmp.diff.fromDelta('', '+%c3%xy'))

  // Test deltas with special characters.
  diffs = [[Operation.DIFF_EQUAL, '\u0680 \x00 \t %'], [Operation.DIFF_DELETE, '\u0681 \x01 \n ^'], [Operation.DIFF_INSERT, '\u0682 \x02 \\ |']]
  text1 = dmp.diff.text1(diffs)
  t.equals(text1, '\u0680 \x00 \t %\u0681 \x01 \n ^')

  delta = dmp.diff.toDelta(diffs)
  t.equals(delta, '=7\t-7\t+%DA%82 %02 %5C %7C')

  // Convert delta string into a diff.
  t.isEquivalent(dmp.diff.fromDelta(text1, delta), diffs)

  // Verify pool of unchanged characters.
  diffs = [[Operation.DIFF_INSERT, 'A-Z a-z 0-9 - _ . ! ~ * \' ( ) ; / ? : @ & = + $ , # ']]
  const text2 = dmp.diff.text2(diffs)
  t.equals(
    text2,
    'A-Z a-z 0-9 - _ . ! ~ * \' ( ) ; / ? : @ & = + $ , # '
  )

  delta = dmp.diff.toDelta(diffs)
  t.equals(
    delta,
    '+A-Z a-z 0-9 - _ . ! ~ * \' ( ) ; / ? : @ & = + $ , # '
  )

  // Convert delta string into a diff.
  t.isEquivalent(dmp.diff.fromDelta('', delta), diffs)

  // 160 kb string.
  let a = 'abcdefghij'
  for (let i = 0; i < 14; i++) {
    a += a
  }
  diffs = [[Operation.DIFF_INSERT, a]]
  delta = dmp.diff.toDelta(diffs)
  t.equals(delta, '+' + a)

  // Convert delta string into a diff.
  t.isEquivalent(dmp.diff.fromDelta('', delta), diffs)

  t.end()
})

test('testDiffXIndex', t => {
  // Translate a location in text1 to text2.
  // Translation on equality.
  t.equals(
    dmp.diff.xIndex([[Operation.DIFF_DELETE, 'a'], [Operation.DIFF_INSERT, '1234'], [Operation.DIFF_EQUAL, 'xyz']], 2),
    5
  )

  // Translation on deletion.
  t.equals(
    dmp.diff.xIndex([[Operation.DIFF_EQUAL, 'a'], [Operation.DIFF_DELETE, '1234'], [Operation.DIFF_EQUAL, 'xyz']], 3),
    1
  )

  t.end()
})

test('testDiffLevenshtein', t => {
  // Levenshtein with trailing equality.
  t.equals(
    dmp.diff.levenshtein([[Operation.DIFF_DELETE, 'abc'], [Operation.DIFF_INSERT, '1234'], [Operation.DIFF_EQUAL, 'xyz']]),
    4
  )
  // Levenshtein with leading equality.
  t.equals(
    dmp.diff.levenshtein([[Operation.DIFF_EQUAL, 'xyz'], [Operation.DIFF_DELETE, 'abc'], [Operation.DIFF_INSERT, '1234']]),
    4
  )
  // Levenshtein with middle equality.
  t.equals(
    dmp.diff.levenshtein([[Operation.DIFF_DELETE, 'abc'], [Operation.DIFF_EQUAL, 'xyz'], [Operation.DIFF_INSERT, '1234']]),
    7
  )

  t.end()
})

test('testDiffBisect', t => {
  // Normal.
  const a = 'cat'
  const b = 'map'
  // Since the resulting diff hasn't been normalized, it would be ok if
  // the insertion and deletion pairs are swapped.
  // If the order changes, tweak this test as required.
  t.isEquivalent(
    dmp.diff.bisect(a, b, Number.MAX_VALUE),
    [[Operation.DIFF_DELETE, 'c'], [Operation.DIFF_INSERT, 'm'], [Operation.DIFF_EQUAL, 'a'], [Operation.DIFF_DELETE, 't'], [Operation.DIFF_INSERT, 'p']]
  )

  // Timeout.
  t.isEquivalent(
    dmp.diff.bisect(a, b, 0),
    [[Operation.DIFF_DELETE, 'cat'], [Operation.DIFF_INSERT, 'map']]
  )

  t.end()
})

test('testDiffMain', t => {
  // Perform a trivial diff.
  // Null case.
  t.isEquivalent(dmp.diff.main('', '', false), [])

  // Equality.
  t.isEquivalent(
    dmp.diff.main('abc', 'abc', false),
    [[Operation.DIFF_EQUAL, 'abc']]
  )

  // Simple insertion.
  t.isEquivalent(
    [[Operation.DIFF_EQUAL, 'ab'], [Operation.DIFF_INSERT, '123'], [Operation.DIFF_EQUAL, 'c']],
    dmp.diff.main('abc', 'ab123c', false)
  )

  // Simple deletion.
  t.isEquivalent(
    dmp.diff.main('a123bc', 'abc', false),
    [[Operation.DIFF_EQUAL, 'a'], [Operation.DIFF_DELETE, '123'], [Operation.DIFF_EQUAL, 'bc']]
  )

  // Two insertions.
  t.isEquivalent(
    dmp.diff.main('abc', 'a123b456c', false),
    [[Operation.DIFF_EQUAL, 'a'], [Operation.DIFF_INSERT, '123'], [Operation.DIFF_EQUAL, 'b'], [Operation.DIFF_INSERT, '456'], [Operation.DIFF_EQUAL, 'c']]
  )

  // Two deletions.
  t.isEquivalent(
    dmp.diff.main('a123b456c', 'abc', false),
    [[Operation.DIFF_EQUAL, 'a'], [Operation.DIFF_DELETE, '123'], [Operation.DIFF_EQUAL, 'b'], [Operation.DIFF_DELETE, '456'], [Operation.DIFF_EQUAL, 'c']]
  )

  // Perform a real diff.
  // Switch off the timeout.
  dmp.diff.timeout = 0
  // Simple cases.
  t.isEquivalent(
    [[Operation.DIFF_DELETE, 'a'], [Operation.DIFF_INSERT, 'b']],
    dmp.diff.main('a', 'b', false)
  )

  t.isEquivalent(
    dmp.diff.main('Apples are a fruit.', 'Bananas are also fruit.', false),
    [[Operation.DIFF_DELETE, 'Apple'], [Operation.DIFF_INSERT, 'Banana'], [Operation.DIFF_EQUAL, 's are a'], [Operation.DIFF_INSERT, 'lso'], [Operation.DIFF_EQUAL, ' fruit.']]
  )

  t.isEquivalent(
    dmp.diff.main('ax\t', '\u0680x\0', false),
    [[Operation.DIFF_DELETE, 'a'], [Operation.DIFF_INSERT, '\u0680'], [Operation.DIFF_EQUAL, 'x'], [Operation.DIFF_DELETE, '\t'], [Operation.DIFF_INSERT, '\0']]
  )

  // Overlaps.
  t.isEquivalent(
    dmp.diff.main('1ayb2', 'abxab', false),
    [[Operation.DIFF_DELETE, '1'], [Operation.DIFF_EQUAL, 'a'], [Operation.DIFF_DELETE, 'y'], [Operation.DIFF_EQUAL, 'b'], [Operation.DIFF_DELETE, '2'], [Operation.DIFF_INSERT, 'xab']]
  )

  t.isEquivalent(
    dmp.diff.main('abcy', 'xaxcxabc', false),
    [[Operation.DIFF_INSERT, 'xaxcx'], [Operation.DIFF_EQUAL, 'abc'], [Operation.DIFF_DELETE, 'y']]
  )

  t.isEquivalent(
    dmp.diff.main('ABCDa=bcd=efghijklmnopqrsEFGHIJKLMNOefg', 'a-bcd-efghijklmnopqrs', false),
    [[Operation.DIFF_DELETE, 'ABCD'], [Operation.DIFF_EQUAL, 'a'], [Operation.DIFF_DELETE, '='], [Operation.DIFF_INSERT, '-'], [Operation.DIFF_EQUAL, 'bcd'], [Operation.DIFF_DELETE, '='], [Operation.DIFF_INSERT, '-'], [Operation.DIFF_EQUAL, 'efghijklmnopqrs'], [Operation.DIFF_DELETE, 'EFGHIJKLMNOefg']]
  )

  // Large equality.
  t.isEquivalent(
    dmp.diff.main('a [[Pennsylvania]] and [[New', ' and [[Pennsylvania]]', false),
    [[Operation.DIFF_INSERT, ' '], [Operation.DIFF_EQUAL, 'a'], [Operation.DIFF_INSERT, 'nd'], [Operation.DIFF_EQUAL, ' [[Pennsylvania]]'], [Operation.DIFF_DELETE, ' and [[New']]
  )

  // Timeout.
  dmp.diff.timeout = 0.1 // 100ms
  let a = '`Twas brillig, and the slithy toves\nDid gyre and gimble in the wabe:\nAll mimsy were the borogoves,\nAnd the mome raths outgrabe.\n'
  let b = 'I am the very model of a modern major general,\nI\'ve information vegetable, animal, and mineral,\nI know the kings of England, and I quote the fights historical,\nFrom Marathon to Waterloo, in order categorical.\n'
  // Increase the text lengths by 1024 times to ensure a timeout.
  for (let i = 0; i < 10; i++) {
    a += a
    b += b
  }
  const startTime = (new Date()).getTime()
  dmp.diff.main(a, b)
  const endTime = (new Date()).getTime()
  // Test that we took at least the timeout period.
  t.true(dmp.diff.timeout * 1000 <= endTime - startTime)
  // Test that we didn't take forever (be forgiving).
  // Theoretically this test could fail very occasionally if the
  // OS task swaps or locks up for a second at the wrong moment.
  t.true(dmp.diff.timeout * 1000 * 2 > endTime - startTime)
  dmp.diff.timeout = 0

  // Test the linemode speedup.
  // Must be long to pass the 100 char cutoff.
  // Simple line-mode.
  a = '1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n'
  b = 'abcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\nabcdefghij\n'
  t.isEquivalent(
    dmp.diff.main(a, b, true),
    dmp.diff.main(a, b, false)
  )

  // Single line-mode.
  a = '1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890'
  b = 'abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij'
  t.isEquivalent(
    dmp.diff.main(a, b, true),
    dmp.diff.main(a, b, false)
  )

  // Overlap line-mode.
  a = '1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n1234567890\n'
  b = 'abcdefghij\n1234567890\n1234567890\n1234567890\nabcdefghij\n1234567890\n1234567890\n1234567890\nabcdefghij\n1234567890\n1234567890\n1234567890\nabcdefghij\n'
  const textsLinemode = rebuildTexts(dmp.diff.main(a, b, true))
  const textsTextmode = rebuildTexts(dmp.diff.main(a, b, false))
  t.isEquivalent(textsLinemode, textsTextmode)

  // Test null inputs.
  // @ts-expect-error
  t.throws(() => dmp.diff.main(null, null))

  t.end()
})
