// A lint rule: an amount on screen is drawn by <Money>, never dropped into
// the page as text a money formatter made (web/src/lib/money.ts).
//
// It catches a formatted amount reaching the page:
// - straight from a formatter: {money(500)}, {`${app.money(500)} left`}, a prop;
// - through a variable: const budget = money(500), then {budget}, and through
//   any variable made from one (const line = `${budget} left`);
// - through another name for a formatter: const fmt = money, const fmt =
//   app.money, or const { money: fmt } = useApp().
// Text a screen reader reads, where no element can go, is spelled out and
// left alone (TEXT_ATTRIBUTES).
//
// What it cannot follow, without type information, is documented in
// web/src/lib/money.ts: a formatted amount returned from a function, kept in
// an object or array, passed through another function, or assigned to a
// variable after it was declared.

/** The formatters, by the names they are imported and used under. */
const FORMATTERS = /^(money|exact|signed|formatMoney|signedAmount|compactMoney)$/

/** The formatters as methods of the app's settings: app.money(500). */
const METHODS = /^(money|exact|signed)$/

/**
 * Attributes a screen reader reads as plain text, where an element can't go:
 * an amount is spelled out there ("Blue Bottle, spent $5.75"), never drawn.
 */
const TEXT_ATTRIBUTES = /^(aria-label|aria-valuetext|title|description)$/

export const MESSAGE = 'Show an amount with <Money cents={...} />, not as formatted text.'

/** Whether a node is inside a JSX expression that draws on the page, not a screen reader's text. */
function shownOnPage(node) {
  let inExpression = false
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'JSXAttribute' && TEXT_ATTRIBUTES.test(parent.name.name)) return false
    if (parent.type === 'JSXExpressionContainer') inExpression = true
  }
  return inExpression
}

/**
 * The expressions whose value can become `node`'s value, as text: a template's
 * parts, either side of a ternary, an || or a +, and the node itself. An
 * amount passed to another function, like textWidth(money(500)), is not one:
 * what that returns is something else, a width.
 */
function valuesOf(node) {
  switch (node.type) {
    case 'TemplateLiteral':
      return [node, ...node.expressions.flatMap(valuesOf)]
    case 'ConditionalExpression':
      return [node, ...valuesOf(node.consequent), ...valuesOf(node.alternate)]
    case 'LogicalExpression':
      return [node, ...valuesOf(node.left), ...valuesOf(node.right)]
    case 'BinaryExpression':
      return node.operator === '+'
        ? [node, ...valuesOf(node.left), ...valuesOf(node.right)]
        : [node]
    case 'TSAsExpression':
    case 'TSNonNullExpression':
    case 'TSSatisfiesExpression':
      return [node, ...valuesOf(node.expression)]
    default:
      return [node]
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export const moneyText = {
  meta: {
    type: 'problem',
    docs: { description: 'Show amounts with <Money>, not as text a money formatter made.' },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context
    const declarators = []
    const calls = []
    /** Local names that are another name for a formatter. */
    const aliases = new Set()

    /** Whether an expression is a formatter itself (not a call of one). */
    const isFormatter = (node) =>
      (node?.type === 'Identifier' && (FORMATTERS.test(node.name) || aliases.has(node.name))) ||
      (node?.type === 'MemberExpression' &&
        !node.computed &&
        node.property.type === 'Identifier' &&
        METHODS.test(node.property.name))

    /** The names a declarator gives a formatter: const fmt = money, or const { money: fmt } = app. */
    function aliasesIn({ id, init }) {
      if (id.type === 'Identifier' && isFormatter(init)) return [id.name]
      if (id.type !== 'ObjectPattern') return []
      return id.properties.flatMap((property) =>
        property.type === 'Property' &&
        property.key.type === 'Identifier' &&
        (FORMATTERS.test(property.key.name) || METHODS.test(property.key.name)) &&
        property.value.type === 'Identifier'
          ? [property.value.name]
          : [],
      )
    }

    /** Adds every name in `found` to `set`; true when any was new. */
    const addAll = (set, found) =>
      found.filter((item) => !set.has(item) && set.add(item)).length > 0

    return {
      VariableDeclarator: (node) => declarators.push(node),
      CallExpression: (node) => calls.push(node),
      'Program:exit'() {
        // Other names first, since a formatted variable may be made with one.
        while (declarators.some((node) => addAll(aliases, aliasesIn(node)))) {
          // Each pass may find an alias of an alias.
        }

        // Variables holding formatted text, and those made from them, until no more are found.
        const formatted = new Set()
        /** Every place a formatted variable is read. */
        const reads = () =>
          new Set(
            [...formatted].flatMap((variable) =>
              variable.references.filter((ref) => ref.isRead()).map((ref) => ref.identifier),
            ),
          )
        const holdsAmount = (init, readNodes) =>
          valuesOf(init).some(
            (node) =>
              (node.type === 'CallExpression' && isFormatter(node.callee)) || readNodes.has(node),
          )
        const variablesOf = (node, readNodes) =>
          node.id.type === 'Identifier' && node.init && holdsAmount(node.init, readNodes)
            ? sourceCode.getDeclaredVariables(node)
            : []
        for (let found = true; found;) {
          const readNodes = reads()
          found = declarators.some((node) => addAll(formatted, variablesOf(node, readNodes)))
        }

        for (const call of calls) {
          if (isFormatter(call.callee) && shownOnPage(call)) {
            context.report({ node: call, message: MESSAGE })
          }
        }
        for (const identifier of reads()) {
          if (shownOnPage(identifier)) context.report({ node: identifier, message: MESSAGE })
        }
      },
    }
  },
}
