import Patch, { PatchParams } from './Patch'
import Diff, { DiffParams } from './Diff'
import Match, { MatchParams } from './Match'

/**
 * Class containing the diff, match and patch methods.
 */
export default class DiffMatchPatch {
  diff: Diff
  match: Match
  patch: Patch

  constructor (params: DiffParams & MatchParams & PatchParams = {}) {
    this.diff = new Diff(params)
    this.match = new Match(params)
    this.patch = new Patch(this.diff, this.match, params)
  }
}
