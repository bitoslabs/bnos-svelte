import { describe, expect, it } from 'vitest';
import { permissionForPath, selfServiceRoutes } from './nav';

describe('route access policy', () => {
	it('keeps personal settings available to every authenticated role', () => {
		for (const path of selfServiceRoutes) {
			expect(permissionForPath(path)).toBeUndefined();
		}
	});

	it('does not let the broad settings rule override a personal route', () => {
		expect(permissionForPath('/settings')).toBeUndefined();
		expect(permissionForPath('/settings/profile')).toBeUndefined();
		expect(permissionForPath('/settings/appearance')).toBeUndefined();
		expect(permissionForPath('/settings/notifications')).toBeUndefined();
	});

	it('continues to protect business settings', () => {
		expect(permissionForPath('/settings/store')).toEqual({ resource: 'settings', action: 'write' });
		expect(permissionForPath('/settings/organization')).toEqual({ resource: 'settings', action: 'write' });
	});
});
