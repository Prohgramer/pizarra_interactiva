/**
 * Preparación de las pruebas del cliente: matchers de DOM y limpieza entre
 * casos (sin `globals`, Testing Library no la engancha sola).
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(cleanup);
