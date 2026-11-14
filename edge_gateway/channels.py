"""Canonical Aegis OS telemetry channel names shared by every edge adapter."""

FLUID_CHANNELS = ("acid", "fr_slug", "mmfr_slugs", "gel_pills", "water_flush")
FLUID_RATE_CHANNELS = tuple(f"{f}_rate" for f in FLUID_CHANNELS)
FLUID_VOLUME_CHANNELS = tuple(f"{f}_vol" for f in FLUID_CHANNELS)
FLUID_TOTAL_CHANNELS = ("fluids_total_rate", "fluids_total_vol")
INJECTOR_CHANNELS = ("injector_speed_ft_per_min", "injector_direction")
ENCODER_CHANNELS = ("encoder_1_depth_ft", "encoder_2_depth_ft", "encoder_3_depth_ft")
PROCESS_CHANNELS = ("wellhead_pressure_psi", "circulating_pressure_psi", "pipe_weight_lbs")

# Channels that adapters may map from vendor tags (derived totals excluded).
MAPPABLE_CHANNELS = (
    *[c for pair in zip(FLUID_RATE_CHANNELS, FLUID_VOLUME_CHANNELS) for c in pair],
    *INJECTOR_CHANNELS, *ENCODER_CHANNELS, *PROCESS_CHANNELS,
)
CANONICAL_CHANNELS = MAPPABLE_CHANNELS + FLUID_TOTAL_CHANNELS

ENCODER_DRIFT_THRESHOLD_FT = 2.0
