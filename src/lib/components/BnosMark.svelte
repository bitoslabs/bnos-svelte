<script lang="ts">
	/**
	 * BNOS logo mark — hexagon + lightning body with animated wings.
	 *
	 * Inlined from `assets/icons/bnos-logo.svg`. The body uses `currentColor`
	 * so it follows the surrounding text colour (dark on light, light on dark);
	 * the wings keep the brand orange gradient. Ids are namespaced per instance
	 * so multiple marks on one page keep their own gradients.
	 */
	let { class: className = 'size-6' } = $props<{ class?: string }>();

	const uid = $props.id();
	const wingR = `bnos-wing-r-${uid}`;
	const wingL = `bnos-wing-l-${uid}`;
</script>

<svg
	class="bnos-mark {className}"
	viewBox="0 0 240.272 154.869"
	xmlns="http://www.w3.org/2000/svg"
	aria-hidden="true"
>
	<defs>
		<linearGradient
			id={wingR}
			x1="242.638"
			y1="26.983"
			x2="242.638"
			y2="91.402"
			gradientUnits="userSpaceOnUse"
		>
			<stop offset="0" stop-color="#f7b506" />
			<stop offset="0.5246" stop-color="#f59f10" />
			<stop offset="0.9995" stop-color="#f28919" />
		</linearGradient>
		<linearGradient
			id={wingL}
			x1="110.166"
			y1="26.983"
			x2="110.166"
			y2="91.402"
			gradientUnits="userSpaceOnUse"
		>
			<stop offset="0" stop-color="#f7b506" />
			<stop offset="0.5246" stop-color="#f59f10" />
			<stop offset="0.9995" stop-color="#f28919" />
		</linearGradient>
	</defs>
	<g class="bnos-body" fill="currentColor">
		<path
			d="M143.762 32.154 L143.762 18.703 C143.762 14.424 141.479 10.47 137.773 8.33 L126.125 1.605 C122.419 -0.535 117.853 -0.535 114.147 1.605 L102.498 8.33 C98.792 10.47 96.509 14.424 96.509 18.703 L96.509 32.154 C96.509 36.433 98.792 40.387 102.498 42.527 L114.147 49.252 C117.853 51.392 122.419 51.392 126.125 49.252 L137.773 42.527 C141.479 40.387 143.762 36.433 143.762 32.154 Z"
		/>
		<path
			d="M113.396 105.427 L85.215 89.16 C86.031 88.284 86.977 87.515 88.054 86.9 L113.94 71.958 C117.773 69.745 122.505 69.745 126.339 71.958 L152.213 86.9 C153.289 87.515 154.248 88.284 155.064 89.16 L126.871 105.427 C122.718 107.829 117.548 107.829 113.396 105.427 Z"
		/>
		<path
			d="M158.412 97.643 L158.412 127.527 C158.412 131.952 156.058 136.046 152.213 138.27 L126.339 153.2 C122.505 155.425 117.773 155.425 113.94 153.2 L88.054 138.27 C84.221 136.046 81.855 131.952 81.855 127.527 L81.855 97.643 C81.855 96.412 82.044 95.194 82.387 94.046 L110.568 110.325 C112.225 111.283 113.999 111.97 115.821 112.384 L108.912 126.238 L119.607 126.238 L110.58 146.551 L134.537 120.109 L124.943 120.109 L132.029 108.976 L157.88 94.046 C158.223 95.194 158.412 96.412 158.412 97.643 Z"
		/>
	</g>
	<g class="bnos-wing bnos-wing-left">
		<path
			d="M107.8 61.641 L107.8 61.641 C107.8 58.851 106.263 56.287 103.802 54.973 L44.104 23.096 C39.544 20.661 34.05 20.752 29.573 23.337 L7.482 36.091 C2.852 38.764 0 43.704 0 49.051 L0 74.231 C0 79.578 2.852 84.518 7.482 87.191 L29.573 99.945 C34.05 102.53 39.544 102.621 44.104 100.186 L103.802 68.309 C106.263 66.995 107.8 64.431 107.8 61.641 Z"
			fill="url(#{wingL})"
		/>
	</g>
	<g class="bnos-wing bnos-wing-right">
		<path
			d="M132.472 61.641 L132.472 61.641 C132.472 58.851 134.009 56.287 136.47 54.973 L196.168 23.096 C200.728 20.661 206.222 20.752 210.698 23.337 L232.789 36.091 C237.419 38.764 240.272 43.704 240.272 49.051 L240.272 74.231 C240.272 79.578 237.419 84.518 232.789 87.191 L210.698 99.945 C206.222 102.53 200.728 102.621 196.168 100.186 L136.47 68.309 C134.009 66.995 132.472 64.431 132.472 61.641 Z"
			fill="url(#{wingR})"
		/>
	</g>
</svg>

<style>
	.bnos-mark {
		overflow: visible;
		animation: bnos-float 2.8s ease-in-out infinite;
	}

	.bnos-wing {
		transform-box: view-box;
	}

	.bnos-wing-left {
		transform-origin: 107.8px 61.6px;
		animation: bnos-flap-left 0.42s ease-in-out infinite alternate;
	}

	.bnos-wing-right {
		transform-origin: 132.5px 61.6px;
		animation: bnos-flap-right 0.42s ease-in-out infinite alternate;
	}

	@keyframes bnos-float {
		0%,
		100% {
			transform: translateY(0) rotate(0deg);
		}
		50% {
			transform: translateY(-2px) rotate(-1.5deg);
		}
	}

	@keyframes bnos-flap-left {
		from {
			transform: rotate(-6deg);
		}
		to {
			transform: rotate(6deg);
		}
	}

	@keyframes bnos-flap-right {
		from {
			transform: rotate(6deg);
		}
		to {
			transform: rotate(-6deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.bnos-mark,
		.bnos-wing-left,
		.bnos-wing-right {
			animation: none;
		}
	}
</style>
