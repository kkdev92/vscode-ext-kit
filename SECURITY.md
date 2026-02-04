# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability:

1. **Do NOT** create a public GitHub issue
2. Use GitHub's "Report a vulnerability" feature in the Security tab

## Security Best Practices

When using this library in your VS Code extension:

### Secrets Storage

Always use `createSecretStorage` for sensitive data:

```typescript
// Good - uses VS Code's secure storage
const apiKeyStorage = createSecretStorage(context, 'myExtension.apiKey');
await apiKeyStorage.set(apiKey);

// Bad - stores in plain text
await context.globalState.update('apiKey', apiKey);
```

### Input Validation

Validate user input before processing:

```typescript
const input = await inputText({
  prompt: 'Enter value',
  validate: (value) => {
    if (!value || value.trim().length === 0) {
      return 'Value cannot be empty';
    }
    return undefined;
  },
});
```

### Error Handling

Use `safeExecute` to prevent information leakage in error messages:

```typescript
await safeExecute(logger, 'Operation', async () => {
  // Your code here
}, {
  userMessage: 'Operation failed. Please try again.',
});
```

## Security Considerations

1. **No Network Access**: This library does not make any network requests
2. **No File System Access**: File operations are delegated to VS Code APIs
3. **Secure Storage**: Secret storage uses VS Code's encrypted storage API
