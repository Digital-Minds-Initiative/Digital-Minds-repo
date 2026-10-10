import { apiNotFound } from '@/server/http';

// Unknown /api/v1 endpoints answer with the standard JSON error envelope (not an HTML page).
export const GET = apiNotFound;
export const POST = apiNotFound;
export const PUT = apiNotFound;
export const PATCH = apiNotFound;
export const DELETE = apiNotFound;
