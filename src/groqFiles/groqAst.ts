/**
 * The GROQ AST that `parse` from groq-js returns. groq-js 2.0 declares these nodes in a module
 * its published type declarations do not include, so they reach consumers as `any`. The shapes
 * here mirror groq-js's `src/shared/nodeTypes.ts` so the walkers in this directory can narrow
 * on `type` exhaustively.
 */

export type OpCall =
  | '!='
  | '%'
  | '*'
  | '**'
  | '+'
  | '-'
  | '/'
  | '<'
  | '<='
  | '=='
  | '>'
  | '>='
  | 'in'
  | 'match'

export type ExprNode =
  | AccessAttributeNode
  | AccessElementNode
  | AndNode
  | ArrayCoerceNode
  | ArrayNode
  | AscNode
  | ContextNode
  | DerefNode
  | DescNode
  | EverythingNode
  | FilterNode
  | FlatMapNode
  | FuncCallNode
  | GroupNode
  | InRangeNode
  | MapNode
  | NegNode
  | NotNode
  | ObjectNode
  | OpCallNode
  | OrNode
  | ParameterNode
  | ParentNode
  | PipeFuncCallNode
  | PosNode
  | ProjectionNode
  | SelectNode
  | SelectorFuncCallNode
  | SelectorNestedNode
  | SliceNode
  | ThisNode
  | TupleNode
  | ValueNode

export type ObjectAttributeNode =
  | ObjectAttributeValueNode
  | ObjectConditionalSplatNode
  | ObjectSplatNode

export interface AccessAttributeNode {
  name: string
  type: 'AccessAttribute'

  base?: ExprNode
}

export interface AccessElementNode {
  base: ExprNode
  index: number
  type: 'AccessElement'
}

export interface AndNode {
  left: ExprNode
  right: ExprNode
  type: 'And'
}

export interface ArrayCoerceNode {
  base: ExprNode
  type: 'ArrayCoerce'
}

export interface ArrayElementNode {
  isSplat: boolean
  type: 'ArrayElement'
  value: ExprNode
}

export interface ArrayNode {
  elements: ArrayElementNode[]
  type: 'Array'
}

export interface AscNode {
  base: ExprNode
  type: 'Asc'
}

export interface ContextNode {
  key: string
  type: 'Context'
}

export interface DerefNode {
  base: ExprNode
  type: 'Deref'
}

export interface DescNode {
  base: ExprNode
  type: 'Desc'
}

export interface EverythingNode {
  type: 'Everything'
}

export interface FilterNode {
  base: ExprNode
  expr: ExprNode
  type: 'Filter'
}

export interface FlatMapNode {
  base: ExprNode
  expr: ExprNode
  type: 'FlatMap'
}

export interface FuncCallNode {
  args: ExprNode[]
  name: string
  namespace: string
  type: 'FuncCall'
}

export interface GroupNode {
  base: ExprNode
  type: 'Group'
}

export interface InRangeNode {
  base: ExprNode
  isInclusive: boolean
  left: ExprNode
  right: ExprNode
  type: 'InRange'
}

export interface MapNode {
  base: ExprNode
  expr: ExprNode
  type: 'Map'
}

export interface NegNode {
  base: ExprNode
  type: 'Neg'
}

export interface NotNode {
  base: ExprNode
  type: 'Not'
}

export interface ObjectAttributeValueNode {
  name: string
  type: 'ObjectAttributeValue'
  value: ExprNode
}

export interface ObjectConditionalSplatNode {
  condition: ExprNode
  type: 'ObjectConditionalSplat'
  value: ExprNode
}

export interface ObjectNode {
  attributes: ObjectAttributeNode[]
  type: 'Object'
}

export interface ObjectSplatNode {
  type: 'ObjectSplat'
  value: ExprNode
}

export interface OpCallNode {
  left: ExprNode
  op: OpCall
  right: ExprNode
  type: 'OpCall'
}

export interface OrNode {
  left: ExprNode
  right: ExprNode
  type: 'Or'
}

export interface ParameterNode {
  name: string
  type: 'Parameter'
}

export interface ParentNode {
  n: number
  type: 'Parent'
}

export interface PipeFuncCallNode {
  args: ExprNode[]
  base: ExprNode
  name: string
  type: 'PipeFuncCall'
}

export interface PosNode {
  base: ExprNode
  type: 'Pos'
}

export interface ProjectionNode {
  base: ExprNode
  expr: ExprNode
  type: 'Projection'
}

export interface SelectAlternativeNode {
  condition: ExprNode
  type: 'SelectAlternative'
  value: ExprNode
}

export interface SelectNode {
  alternatives: SelectAlternativeNode[]
  type: 'Select'

  fallback?: ExprNode
}

export interface SelectorFuncCallNode {
  arg: ExprNode
  name: 'anywhere'
  type: 'SelectorFuncCall'
}

export interface SelectorNestedNode {
  base: ExprNode
  nested: ExprNode
  type: 'SelectorNested'
}

/** `left` and `right` are numbers: groq-js only parses a slice once both bounds are constants. */
export interface SliceNode {
  base: ExprNode
  isInclusive: boolean
  left: number
  right: number
  type: 'Slice'
}

export interface ThisNode {
  type: 'This'
}

export interface TupleNode {
  members: ExprNode[]
  type: 'Tuple'
}

export interface ValueNode {
  type: 'Value'
  value: unknown
}
