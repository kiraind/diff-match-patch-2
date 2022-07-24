import test from 'tape'

import DiffMatchPatch from './index'

const dmp = new DiffMatchPatch()

// MATCH TEST FUNCTIONS

test('testMatchAlphabet', t => {
  // Initialise the bitmasks for Bitap.
  // Unique.
  t.isEquivalent(
    dmp.match_alphabet_('abc'),
    { a: 4, b: 2, c: 1 }
  )

  // Duplicates.
  t.isEquivalent(
    dmp.match_alphabet_('abcaba'),
    { a: 37, b: 18, c: 8 }
  )

  t.end()
})

test('testMatchBitap', t => {
  // Bitap algorithm.
  dmp.matchDistance = 100
  dmp.matchThreshold = 0.5

  // Exact matches.
  t.equals(
    dmp.match_bitap_('abcdefghijk', 'fgh', 5),
    5
  )

  t.equals(
    dmp.match_bitap_('abcdefghijk', 'fgh', 0),
    5
  )

  // Fuzzy matches.
  t.equals(
    dmp.match_bitap_('abcdefghijk', 'efxhi', 0),
    4
  )

  t.equals(
    dmp.match_bitap_('abcdefghijk', 'cdefxyhijk', 5),
    2
  )

  t.equals(
    dmp.match_bitap_('abcdefghijk', 'bxy', 1),
    -1
  )

  // Overflow.
  t.equals(
    dmp.match_bitap_('123456789xx0', '3456789x0', 2),
    2
  )

  // Threshold test.
  dmp.matchThreshold = 0.4

  t.equals(
    dmp.match_bitap_('abcdefghijk', 'efxyhi', 1),
    4
  )

  dmp.matchThreshold = 0.3
  t.equals(
    dmp.match_bitap_('abcdefghijk', 'efxyhi', 1),
    -1
  )

  dmp.matchThreshold = 0.0
  t.equals(
    dmp.match_bitap_('abcdefghijk', 'bcdef', 1),
    1
  )

  dmp.matchThreshold = 0.5

  // Multiple select.
  t.equals(
    dmp.match_bitap_('abcdexyzabcde', 'abccde', 3),
    0
  )

  t.equals(
    dmp.match_bitap_('abcdexyzabcde', 'abccde', 5),
    8
  )

  // Distance test.
  dmp.matchDistance = 10 // Strict location.
  t.equals(
    dmp.match_bitap_('abcdefghijklmnopqrstuvwxyz', 'abcdefg', 24),
    -1
  )

  t.equals(
    dmp.match_bitap_('abcdefghijklmnopqrstuvwxyz', 'abcdxxefg', 1),
    0
  )

  dmp.matchDistance = 1000 // Loose location.
  t.equals(
    dmp.match_bitap_('abcdefghijklmnopqrstuvwxyz', 'abcdefg', 24),
    0
  )

  t.end()
})
test('testMatchMain', t => {
  // Full match.
  // Shortcut matches.
  t.equals(
    dmp.match_main('abcdef', 'abcdef', 1000),
    0
  )

  t.equals(
    dmp.match_main('', 'abcdef', 1),
    -1
  )

  t.equals(
    dmp.match_main('abcdef', '', 3),
    3
  )

  t.equals(
    dmp.match_main('abcdef', 'de', 3),
    3
  )

  // Beyond end match.
  t.equals(
    dmp.match_main('abcdef', 'defy', 4),
    3
  )

  // Oversized pattern.
  t.equals(
    dmp.match_main('abcdef', 'abcdefy', 0),
    0
  )

  // Complex match.
  t.equals(
    dmp.match_main('I am the very model of a modern major general.', ' that berry ', 5),
    4
  )

  t.throws(() => {
    // @ts-expect-error
    dmp.match_main(null, null, 0)
  })

  t.end()
})
