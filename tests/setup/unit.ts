import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Unit tests never touch a database. Server modules validate their environment when imported,
// so give them harmless values (real ones from .env win).
process.env.DATABASE_URL ??= 'postgresql://unit:unit@localhost:5432/unit_test';
process.env.ALLOWED_EMAIL_DOMAINS ??= 'uqu.edu.sa';

// Component tests wait on mocked responses and on Radix animations; the library's 1 s default is
// too tight when the whole suite shares the processor.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});
