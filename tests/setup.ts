import { vi } from 'vitest';
import { createVSCodeMock } from '../src/testing/index.js';

// Mock vscode module globally
vi.mock('vscode', () => createVSCodeMock(vi));
