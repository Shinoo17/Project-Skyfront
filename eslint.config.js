import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  // `example/` is a vendored reference project with its own repository and its own rules;
  // linting it only ever reports someone else's 188 problems.
  { ignores: ['dist', 'public/basis', 'example'] },
  {
    files: ['**/*.{js,jsx,mjs}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs['recommended-latest'].rules,
      ...reactRefresh.configs.vite.rules,
      'react/prop-types': 'off',
      'react/no-unknown-property': 'off',
    },
  },

  // Everything in scripts/ runs under Node, not in the page.
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
]
