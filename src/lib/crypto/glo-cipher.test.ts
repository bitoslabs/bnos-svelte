import { describe, expect, it } from 'vitest';
import { ENCRYPTED_DOMAIN_BY_TYPE, sensitiveDomainForType, shouldEncryptType } from './glo-cipher';

describe('encrypted-type config (marketplace-aware)', () => {
	it('encrypts marketplace connections (they carry channel API keys)', () => {
		expect(shouldEncryptType('marketplace.connection')).toBe(true);
		expect(sensitiveDomainForType('marketplace.connection')).toBe('settings');
	});

	it('does NOT encrypt public marketplace listings (meant for discovery)', () => {
		expect(shouldEncryptType('marketplace.product')).toBe(false);
	});

	it('does NOT encrypt public marketplace reviews', () => {
		expect(shouldEncryptType('marketplace.review')).toBe(false);
	});

	it('encrypts the sensitive operational types', () => {
		expect(ENCRYPTED_DOMAIN_BY_TYPE['commerce.order']).toBe('order');
		expect(ENCRYPTED_DOMAIN_BY_TYPE['commerce.payment']).toBe('payment');
		expect(ENCRYPTED_DOMAIN_BY_TYPE['crm.customer']).toBe('customer');
		expect(ENCRYPTED_DOMAIN_BY_TYPE['identity.staff']).toBe('staff');
		expect(ENCRYPTED_DOMAIN_BY_TYPE['shift']).toBe('shift');
	});
});
