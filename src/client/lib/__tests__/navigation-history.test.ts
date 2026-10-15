import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  forgetPreviousPage,
  isAuthPath,
  previousInternalPage,
  recordNavigation,
  resetNavigationHistory,
} from '../navigation-history';

// The hook needs the locale-aware router; these tests only use the recording functions.
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({}) }));

beforeEach(resetNavigationHistory);

describe('navigation history for the safe back control', () => {
  it('knows nothing when a sign-in page is opened directly', () => {
    recordNavigation('/login');
    expect(previousInternalPage()).toBeNull();
  });

  it('remembers the page the visitor came from', () => {
    recordNavigation('/');
    recordNavigation('/login');
    expect(previousInternalPage()).toBe('/');
  });

  it('keeps the original page when switching between login and register', () => {
    recordNavigation('/');
    recordNavigation('/login');
    recordNavigation('/register');
    recordNavigation('/login');
    expect(previousInternalPage()).toBe('/');
  });

  it('never offers a sign-in page as the place to go back to', () => {
    recordNavigation('/login');
    recordNavigation('/register');
    expect(previousInternalPage()).toBeNull();
  });

  it('follows the visitor to another internal page', () => {
    recordNavigation('/');
    recordNavigation('/login');
    recordNavigation('/dashboard');
    recordNavigation('/login');
    expect(previousInternalPage()).toBe('/dashboard');
  });

  it('ignores a repeated report of the same page', () => {
    recordNavigation('/');
    recordNavigation('/');
    recordNavigation('/login');
    expect(previousInternalPage()).toBe('/');
  });

  it('forgets the dashboard the visitor just signed out of', () => {
    recordNavigation('/dashboard');
    forgetPreviousPage();
    recordNavigation('/login');
    expect(previousInternalPage()).toBeNull();
  });

  it('recognises the sign-in pages', () => {
    expect(isAuthPath('/login')).toBe(true);
    expect(isAuthPath('/register')).toBe(true);
    expect(isAuthPath('/')).toBe(false);
    expect(isAuthPath('/dashboard')).toBe(false);
  });
});
