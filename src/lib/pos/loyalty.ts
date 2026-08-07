/**
 * Loyalty points math — pure helpers for earn + redeem.
 *
 * Two rates drive everything (configured in Settings → Features → Loyalty):
 *  • `pointsPerCurrency` — points earned per 1 unit of currency spent.
 *  • `pointValue`        — currency value of a single point when redeemed.
 *
 * A customer's live balance lives denormalised on `customer.data.loyaltyPoints`;
 * every earn/redeem also appends a `loyalty-points` (TYPE.loyaltyPoints) ledger
 * record for audit, so the balance is reconstructable from the ledger.
 */
import type { LoyaltyPoints } from '$lib/domain';

/** Whole points earned for a spend amount (floored, never negative). */
export function pointsForSpend(amount: number, pointsPerCurrency: number): number {
	if (amount <= 0 || pointsPerCurrency <= 0) return 0;
	return Math.floor(amount * pointsPerCurrency);
}

/** Currency credit for a number of points. */
export function creditForPoints(points: number, pointValue: number): number {
	if (points <= 0 || pointValue <= 0) return 0;
	return Math.round(points * pointValue * 100) / 100;
}

/** Points required to produce a given credit (ceil — customer pays the round-up). */
export function pointsForCredit(credit: number, pointValue: number): number {
	if (credit <= 0 || pointValue <= 0) return 0;
	return Math.ceil(credit / pointValue);
}

export type RedeemPlan = {
	/** Currency credit applied to the sale. */
	credit: number;
	/** Points deducted from the customer's balance. */
	points: number;
	/** Points left over below the smallest redeemable credit step. */
	remainderPoints: number;
};

/**
 * Largest redemption possible given a balance, capped at `cap` (the sale total).
 * Never redeems more points than the balance, and never more credit than the cap.
 */
export function maxRedeem(balance: number, pointValue: number, cap: number): RedeemPlan {
	if (balance <= 0 || pointValue <= 0 || cap <= 0) {
		return { credit: 0, points: 0, remainderPoints: Math.max(0, balance) };
	}
	const fullCredit = creditForPoints(balance, pointValue);
	const credit = Math.min(fullCredit, cap);
	const points = pointsForCredit(credit, pointValue);
	return {
		credit: Math.round(credit * 100) / 100,
		points,
		remainderPoints: Math.max(0, balance - points)
	};
}

type BuildTxInput = {
	customerId: string;
	type: LoyaltyPoints['type'];
	points: number;
	balanceAfter: number;
	reason?: string;
	orderId?: string;
};

/** Build a loyalty ledger record (earn/redeem/adjust) ready to persist. */
export function buildLoyaltyTx(input: BuildTxInput): LoyaltyPoints {
	return {
		customerId: input.customerId,
		type: input.type,
		points: input.points,
		balanceAfter: input.balanceAfter,
		reason: input.reason,
		orderId: input.orderId,
		expiresAt: undefined
	};
}
