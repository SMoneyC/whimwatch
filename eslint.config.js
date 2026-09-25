import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * In a catalogue, every name must be a message's own parameter or one of the formatting helpers.
 * Anything else is a global or another module: `wontMention: eval` type-checks (eval returns any)
 * and would run whatever creator name it was given.
 */
const catalogReferences = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const allowedImports = new Set(['count', 'list', 'plural']);
    return {
      'Program:exit'(program) {
        const seen = new Set();
        const visit = (scope) => {
          for (const ref of scope.references) {
            if (seen.has(ref) || ref.isTypeReference) continue;
            seen.add(ref);
            const def = ref.resolved?.defs[0];
            const ok =
              (def?.type === 'Parameter') ||
              (def?.type === 'ImportBinding' && allowedImports.has(ref.identifier.name)) ||
              // The catalogue itself, as it's exported.
              (def?.type === 'Variable' && def.node.parent?.parent?.type === 'ExportNamedDeclaration' && ref.init);
            if (!ok) context.report({ node: ref.identifier, message: `"${ref.identifier.name}" isn't a parameter of this message; catalogues use only their parameters, count, list and plural.` });
          }
          scope.childScopes.forEach(visit);
        };
        visit(context.sourceCode.getScope(program));
      },
    };
  },
};

export default tseslint.config(
  { ignores: ['out/', 'dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Translations come from people who use WhimWatch, and a reviewer may not read the language: a
    // catalogue holds text and nothing that could run. Messages are strings, or arrow functions that
    // only put their arguments into text with plural(), count() and list().
    files: ['src/shared/i18n/catalogs/*.ts'],
    plugins: { whimwatch: { rules: { 'catalog-references': catalogReferences } } },
    rules: {
      'whimwatch/catalog-references': 'error',
      'no-restricted-syntax': [
        'error',
        // Nothing but imports and the exported catalogue: code at the top level would run as the app starts.
        { selector: 'Program > :not(ImportDeclaration, ExportNamedDeclaration)', message: 'A catalogue is its imports and the exported catalogue.' },
        { selector: "ImportDeclaration[importKind!='type'][source.value!='../format.js']", message: 'Catalogues import only from ../format.js.' },
        { selector: 'ExportAllDeclaration, ExportNamedDeclaration[source]', message: 'Catalogues re-export nothing: it would load that module into the app.' },
        { selector: "ImportDeclaration[source.value='../format.js'] > ImportSpecifier[imported.name!=/^(count|list|plural)$/]", message: 'Only count, list and plural.' },
        { selector: "CallExpression:not([callee.type='Identifier'][callee.name=/^(count|list|plural)$/])", message: 'Only count(), list() and plural() can be called.' },
        { selector: "MemberExpression:not([computed=false][property.name='length'])", message: 'No property access, apart from .length.' },
        { selector: 'NewExpression, TaggedTemplateExpression, AssignmentExpression, UpdateExpression, AwaitExpression, ImportExpression, YieldExpression, SequenceExpression, SpreadElement', message: 'Not in a catalogue.' },
        { selector: 'FunctionDeclaration, FunctionExpression, ClassDeclaration, ClassExpression, ArrowFunctionExpression > BlockStatement', message: 'Messages are arrow functions returning an expression.' },
        { selector: 'ObjectPattern, ArrayPattern, RestElement, AssignmentPattern', message: 'Parameters are plain names.' },
        { selector: 'ThisExpression, MetaProperty, WithStatement, LabeledStatement', message: 'Not in a catalogue.' },
      ],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
