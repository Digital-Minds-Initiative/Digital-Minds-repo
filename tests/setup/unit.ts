import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Unit tests never touch a database. Server modules validate their environment when imported,
// so give them harmless values (real ones from .env win).
process.env.DATABASE_URL ??= 'postgresql://unit:unit@localhost:5432/unit_test';
process.env.ALLOWED_EMAIL_DOMAINS ??= 'uqu.edu.sa';

afterEach(() => {
  cleanup();
});
