# Contributing to vscode-ext-kit

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## Code of Conduct

Please be respectful and constructive in all interactions.

## Getting Started

### Prerequisites

- Node.js 20.x or later
- npm 10.x or later
- Git

### Development Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/vscode-ext-kit.git
   cd vscode-ext-kit
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run tests:
   ```bash
   npm test
   ```

## Project Structure

```
src/
├── index.ts          # Public API exports
├── types.ts          # TypeScript types and interfaces
├── logger.ts         # Logger implementation
├── commands.ts       # Command registration
├── config.ts         # Configuration utilities
├── progress.ts       # Progress notifications
├── storage.ts        # Storage wrappers
├── ui.ts             # QuickPick and InputBox helpers
├── notification.ts   # Notification helpers
├── statusbar.ts      # Status bar utilities
├── filewatcher.ts    # File watcher with debouncing
├── editor.ts         # Text editor utilities
├── treeview.ts       # TreeDataProvider base class
├── webview.ts        # WebView panel management
└── ...
```

## Development Workflow

### Making Changes

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes

3. Run linting:
   ```bash
   npm run lint
   ```

4. Run tests:
   ```bash
   npm run test
   ```

5. Type check:
   ```bash
   npm run typecheck
   ```

### Commit Messages

Follow conventional commit format:
- `feat: add new feature`
- `fix: fix bug in X`
- `docs: update documentation`
- `refactor: restructure X`
- `test: add tests for X`
- `chore: update dependencies`

### Pull Requests

1. Ensure all tests pass
2. Update documentation if needed
3. Add a clear description of changes
4. Reference any related issues

## Coding Standards

### TypeScript

- Use strict TypeScript (`strict: true`)
- Prefer explicit types over inference for function parameters and return types
- Use `readonly` for immutable properties
- Avoid `any` - use `unknown` if type is truly unknown

### Error Handling

- Use `safeExecute` for user-facing operations
- Include user-friendly messages
- Log technical details for debugging

### Testing

- Write unit tests for all new functionality
- Include both positive and negative test cases
- Test edge cases and error conditions
- Use Vitest for testing

## Reporting Issues

When reporting issues, please include:

- Package version
- VS Code version
- Node.js version
- Steps to reproduce
- Expected vs actual behavior
- Any error messages

## Feature Requests

Feature requests are welcome! Please:

1. Check existing issues first
2. Describe the use case
3. Explain why it would be valuable

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
