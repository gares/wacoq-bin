
module Stateid  = Serlib.Ser_stateid

module Feedback = Serlib.Ser_feedback
module Names    = Serlib.Ser_names
module Evar     = Serlib.Ser_evar
module Loc      = Serlib.Ser_loc
module Pp       = Serlib.Ser_pp

module Proto = struct

module Goals = struct

  type 'a hyp =
    [%import: 'a Serapi.Serapi_goals.hyp]
    [@@deriving to_yojson]

  type info =
    [%import: Serapi.Serapi_goals.info]
    [@@deriving to_yojson]

  type 'a reified_goal =
    [%import: 'a Serapi.Serapi_goals.reified_goal]
    [@@deriving to_yojson]

  type 'a ser_goals =
    [%import: 'a Serapi.Serapi_goals.ser_goals]
    [@@deriving to_yojson]

  type t = Pp.t reified_goal ser_goals
    [@@deriving to_yojson]

end

type search_query =
  | All
  | CurrentFile
  | Keyword of string
  | Locals
  [@@deriving yojson]

type wacoq_cmd =
  | Init
  | Add     of Stateid.t option * Stateid.t option * string * bool
  | Exec    of Stateid.t
  | Cancel  of Stateid.t
  | Goals   of Stateid.t

  | Query   of Stateid.t * Feedback.route_id * string
  | Inspect of Stateid.t * Feedback.route_id * search_query

  | RefreshLoadPath
  [@@deriving yojson]

type wacoq_answer =
  | Ready     of Stateid.t
  | Added     of Stateid.t * Loc.t option
  | BackTo    of Stateid.t
  | GoalInfo  of Stateid.t * Goals.t option
  | Feedback  of Feedback.feedback

  | CoqExn    of Loc.t option * (Stateid.t * Stateid.t) option * Pp.t
  | JsonExn   of string
  [@@deriving to_yojson]

end
