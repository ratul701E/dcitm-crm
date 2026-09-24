import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DelayMode } from '@prisma/client';
import * as crypto from 'crypto';

export { DelayMode };

export const MAX_ALLOWED_DELAY_SECONDS = 3600; // 1-hour system safety limit
export const DEFAULT_MINIMUM_DELAY_SECONDS = 10;

export interface DelayConfig {
  mode?: DelayMode | string;
  minimumDelaySeconds: number;
  maximumDelaySeconds?: number | null;
  seed?: string | null;
  sequenceIndex?: number;
  previousDelay?: number | null;
}

export interface DelayResult {
  delaySeconds: number;
  mode: DelayMode;
  minimumDelaySeconds: number;
  maximumDelaySeconds: number | null;
  effectiveMaximum: number;
  sequenceIndex: number;
}

/**
 * High-quality 32-bit Seeded PRNG based on Mulberry32.
 * Deterministic given the same initial seed string.
 */
export class SeededPRNG {
  private state: number;

  constructor(seed: string, skipCount = 0) {
    this.state = SeededPRNG.hashSeed(seed);
    for (let i = 0; i < skipCount; i++) {
      this.next();
    }
  }

  /**
   * Hashes any seed string into a 32-bit unsigned integer.
   */
  public static hashSeed(seed: string): number {
    let h1 = 0xdeadbeef ^ 0;
    let h2 = 0x41c6ce57 ^ 0;
    for (let i = 0; i < seed.length; i++) {
      const ch = seed.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)) >>> 0;
  }

  /**
   * Generates a pseudo-random float in [0, 1).
   */
  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generates a pseudo-random integer in [min, max] inclusive.
   */
  public nextInt(min: number, max: number): number {
    if (min >= max) return min;
    const u = this.next();
    return Math.floor(min + u * (max - min + 1));
  }
}

@Injectable()
export class EmailDelayService {
  private readonly logger = new Logger(EmailDelayService.name);

  /**
   * Generates a secure random seed string.
   */
  public generateSecureSeed(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Validates delay configuration parameters.
   * Throws BadRequestException on invalid configurations.
   */
  public validateConfig(minimumDelaySeconds: number, maximumDelaySeconds?: number | null): void {
    if (!Number.isFinite(minimumDelaySeconds) || minimumDelaySeconds < 0) {
      throw new BadRequestException('Minimum delay seconds must be an integer >= 0.');
    }

    if (minimumDelaySeconds > MAX_ALLOWED_DELAY_SECONDS) {
      throw new BadRequestException(
        `Minimum delay seconds cannot exceed system maximum of ${MAX_ALLOWED_DELAY_SECONDS} seconds.`,
      );
    }

    if (maximumDelaySeconds !== null && maximumDelaySeconds !== undefined) {
      if (!Number.isFinite(maximumDelaySeconds) || maximumDelaySeconds < 0) {
        throw new BadRequestException('Maximum delay seconds must be an integer >= 0.');
      }
      if (maximumDelaySeconds < minimumDelaySeconds) {
        throw new BadRequestException(
          `Maximum delay (${maximumDelaySeconds}s) cannot be less than minimum delay (${minimumDelaySeconds}s).`,
        );
      }
      if (maximumDelaySeconds > MAX_ALLOWED_DELAY_SECONDS) {
        throw new BadRequestException(
          `Maximum delay seconds cannot exceed system maximum of ${MAX_ALLOWED_DELAY_SECONDS} seconds.`,
        );
      }
    }
  }

  /**
   * Resolves the effective maximum delay.
   * If maximum is not specified, effectiveMaximum = minimum * 3 (or 0 if minimum is 0).
   * Result is always clamped to MAX_ALLOWED_DELAY_SECONDS.
   */
  public getEffectiveMaximum(minimumDelaySeconds: number, maximumDelaySeconds?: number | null): number {
    let effectiveMax: number;

    if (maximumDelaySeconds !== null && maximumDelaySeconds !== undefined) {
      effectiveMax = Math.max(minimumDelaySeconds, maximumDelaySeconds);
    } else {
      effectiveMax = minimumDelaySeconds === 0 ? 0 : minimumDelaySeconds * 3;
    }

    return Math.min(effectiveMax, MAX_ALLOWED_DELAY_SECONDS);
  }

  /**
   * Generates the calculated delay for an email transition.
   */
  public generateDelay(config: DelayConfig): DelayResult {
    const rawMode = config.mode || DelayMode.WEIGHTED_RANDOM;
    const mode = (
      typeof rawMode === 'string' ? rawMode.toUpperCase() : rawMode
    ) as DelayMode;

    const minDelay = Math.max(0, Math.floor(config.minimumDelaySeconds ?? DEFAULT_MINIMUM_DELAY_SECONDS));
    const maxDelay = config.maximumDelaySeconds !== undefined && config.maximumDelaySeconds !== null
      ? Math.floor(config.maximumDelaySeconds)
      : null;

    this.validateConfig(minDelay, maxDelay);

    const effectiveMax = this.getEffectiveMaximum(minDelay, maxDelay);
    const seed = config.seed || 'default-campaign-seed';
    const sequenceIndex = Math.max(0, config.sequenceIndex ?? 0);

    // If min and effectiveMax are equal (e.g. 0 or identical bounds), return min directly
    if (minDelay >= effectiveMax || mode === DelayMode.FIXED) {
      return {
        delaySeconds: minDelay,
        mode: DelayMode.FIXED,
        minimumDelaySeconds: minDelay,
        maximumDelaySeconds: maxDelay,
        effectiveMaximum: effectiveMax,
        sequenceIndex,
      };
    }

    // Initialize PRNG stepped to current sequenceIndex
    const prng = new SeededPRNG(seed, sequenceIndex);

    let delaySeconds = this.computeDelayForMode(mode, minDelay, effectiveMax, prng);

    // Prevent excessive repetition: if the generated value is identical to previous,
    // retry drawing up to 3 times to break rigid repetition patterns.
    if (config.previousDelay !== undefined && config.previousDelay !== null) {
      let retryCount = 0;
      while (delaySeconds === config.previousDelay && retryCount < 3) {
        delaySeconds = this.computeDelayForMode(mode, minDelay, effectiveMax, prng);
        retryCount++;
      }
    }

    return {
      delaySeconds,
      mode,
      minimumDelaySeconds: minDelay,
      maximumDelaySeconds: maxDelay,
      effectiveMaximum: effectiveMax,
      sequenceIndex,
    };
  }

  /**
   * Generates a preview sequence of delays without mutating persistent campaign state.
   */
  public generatePreviewSequence(
    config: {
      mode?: DelayMode | string;
      minimumDelaySeconds: number;
      maximumDelaySeconds?: number | null;
      seed?: string | null;
    },
    count = 10,
  ): { delays: number[]; effectiveMaximum: number; mode: DelayMode } {
    const minDelay = Math.max(0, Math.floor(config.minimumDelaySeconds ?? DEFAULT_MINIMUM_DELAY_SECONDS));
    const maxDelay = config.maximumDelaySeconds !== undefined && config.maximumDelaySeconds !== null
      ? Math.floor(config.maximumDelaySeconds)
      : null;

    this.validateConfig(minDelay, maxDelay);

    const effectiveMax = this.getEffectiveMaximum(minDelay, maxDelay);
    const rawMode = config.mode || DelayMode.WEIGHTED_RANDOM;
    const mode = (
      typeof rawMode === 'string' ? rawMode.toUpperCase() : rawMode
    ) as DelayMode;

    const previewSeed = config.seed || this.generateSecureSeed();
    const prng = new SeededPRNG(previewSeed);

    const delays: number[] = [];
    let prevDelay: number | null = null;

    for (let i = 0; i < count; i++) {
      if (minDelay >= effectiveMax || mode === DelayMode.FIXED) {
        delays.push(minDelay);
        continue;
      }

      let val = this.computeDelayForMode(mode, minDelay, effectiveMax, prng);

      let retryCount = 0;
      while (prevDelay !== null && val === prevDelay && retryCount < 3) {
        val = this.computeDelayForMode(mode, minDelay, effectiveMax, prng);
        retryCount++;
      }

      delays.push(val);
      prevDelay = val;
    }

    return {
      delays,
      effectiveMaximum: effectiveMax,
      mode,
    };
  }

  /**
   * Internal mode dispatcher.
   */
  private computeDelayForMode(
    mode: DelayMode,
    min: number,
    effectiveMax: number,
    prng: SeededPRNG,
  ): number {
    switch (mode) {
      case DelayMode.FIXED:
        return this.generateFixedDelay(min);
      case DelayMode.UNIFORM_RANDOM:
        return this.generateUniformRandomDelay(min, effectiveMax, prng);
      case DelayMode.WEIGHTED_RANDOM:
        return this.generateWeightedRandomDelay(min, effectiveMax, prng);
      case DelayMode.NATURAL:
        return this.generateNaturalDelay(min, effectiveMax, prng);
      default:
        return this.generateWeightedRandomDelay(min, effectiveMax, prng);
    }
  }

  /**
   * Fixed Mode: Exact minimum delay.
   */
  private generateFixedDelay(min: number): number {
    return min;
  }

  /**
   * Uniform Random Mode: Equal-probability distribution across [min, effectiveMax].
   */
  private generateUniformRandomDelay(min: number, effectiveMax: number, prng: SeededPRNG): number {
    const u = prng.next();
    const delay = min + (effectiveMax - min) * u;
    return Math.round(this.clampDelay(delay, min, effectiveMax));
  }

  /**
   * Weighted Random Mode: Skews towards values closer to minimum (u^1.5 curve).
   */
  private generateWeightedRandomDelay(min: number, effectiveMax: number, prng: SeededPRNG): number {
    const u = prng.next();
    const weighted = Math.pow(u, 1.5);
    const delay = min + (effectiveMax - min) * weighted;
    return Math.round(this.clampDelay(delay, min, effectiveMax));
  }

  /**
   * Natural Mode: Weighted base delay + micro-jitter (+-10%) + occasional burst pause (10% prob).
   */
  private generateNaturalDelay(min: number, effectiveMax: number, prng: SeededPRNG): number {
    // Step 1: Base Weighted Delay
    const u = prng.next();
    const weighted = Math.pow(u, 1.5);
    const baseDelay = min + (effectiveMax - min) * weighted;

    // Step 2: Apply Small Jitter (max 1 or 10% of min)
    const jitterRange = Math.max(1, Math.floor(min * 0.1));
    const jitter = prng.nextInt(-jitterRange, jitterRange);
    let delay = baseDelay + jitter;

    // Step 3: Occasional Longer Delay (10% probability)
    const longDelayProbability = 0.1;
    const triggerLongDelay = prng.next() < longDelayProbability;
    if (triggerLongDelay) {
      const remainingRange = Math.max(0, effectiveMax - delay);
      const additionalDelay = prng.nextInt(0, Math.floor(remainingRange));
      delay += additionalDelay;
    }

    // Step 4: Clamp and Round
    return Math.round(this.clampDelay(delay, min, effectiveMax));
  }

  /**
   * Clamps delay within bounds [min, effectiveMax].
   */
  private clampDelay(val: number, min: number, max: number): number {
    return Math.min(Math.max(val, min), max);
  }
}
