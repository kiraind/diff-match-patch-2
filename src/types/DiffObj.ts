import Operation from './Operation'

/**
 * The data structure representing a diff is an array of tuples:
 * [[Operation.DIFF_DELETE, 'Hello'], [Operation.DIFF_INSERT, 'Goodbye'], [Operation.DIFF_EQUAL, ' world.']]
 * which means: delete 'Hello', add 'Goodbye' and keep ' world.'
 */
type DiffObj = [Operation, string]

export default DiffObj
