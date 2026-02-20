# Contributing to AIXplore Recorder

Thank you for your interest in contributing to AIXplore Recorder. This document provides guidelines for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Install dependencies: `npm install`
4. Run the app: `npm start`

## Development Workflow

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes
3. Test your changes by running the app
4. Commit with a clear, descriptive message
5. Push to your fork and open a pull request

## Code Style

- The project uses vanilla JavaScript (ES6+) — no TypeScript, no frameworks
- Follow the existing code patterns and formatting
- Keep functions focused and concise
- Use meaningful variable and function names

## Project Structure

```
src/
├── main.js       # Electron main process
├── preload.js    # IPC bridge
└── index.html    # UI (HTML + CSS + JS)
```

All UI code lives in `index.html`. The main process handles system-level operations. Communication between the two uses Electron's IPC through the preload bridge.

## Pull Request Guidelines

- Keep PRs focused on a single change
- Describe what the PR does and why
- Reference any related issues
- Test on macOS before submitting

## Reporting Issues

When reporting bugs, include:
- macOS version
- Node.js version
- Steps to reproduce
- Expected vs. actual behavior
- Console output if available (View > Toggle Developer Tools)

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
