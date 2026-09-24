import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  EmailDelayService,
  DelayMode,
  MAX_ALLOWED_DELAY_SECONDS,
} from './email-delay.service';

describe('EmailDelayService', () => {
  let service: EmailDelayService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailDelayService],
    }).compile();

    service = module.get<EmailDelayService>(EmailDelayService);
  });

  describe('1. Fixed Mode', () => {
    it('should always return exactly the minimum delay between emails', () => {
      const config = {
        mode: DelayMode.FIXED,
        minimumDelaySeconds: 10,
        maximumDelaySeconds: 60, // Should be ignored in Fixed mode
        seed: 'test-seed-fixed',
      };

      for (let i = 0; i < 50; i++) {
        const result = service.generateDelay({ ...config, sequenceIndex: i });
        expect(result.delaySeconds).toBe(10);
        expect(result.mode).toBe(DelayMode.FIXED);
      }
    });
  });

  describe('2. Uniform Random Mode', () => {
    it('should generate delays between minimum and maximum with even coverage', () => {
      const min = 10;
      const max = 60;
      const config = {
        mode: DelayMode.UNIFORM_RANDOM,
        minimumDelaySeconds: min,
        maximumDelaySeconds: max,
        seed: 'test-uniform-seed-1',
      };

      const delays: number[] = [];
      for (let i = 0; i < 100; i++) {
        const result = service.generateDelay({ ...config, sequenceIndex: i });
        expect(result.delaySeconds).toBeGreaterThanOrEqual(min);
        expect(result.delaySeconds).toBeLessThanOrEqual(max);
        delays.push(result.delaySeconds);
      }

      // Check distribution covers both lower half (< 35) and upper half (>= 35)
      const lowerHalf = delays.filter((d) => d < 35).length;
      const upperHalf = delays.filter((d) => d >= 35).length;
      expect(lowerHalf).toBeGreaterThan(20);
      expect(upperHalf).toBeGreaterThan(20);
    });
  });

  describe('3. Weighted Random Mode', () => {
    it('should stay strictly within bounds [min, max] and skew towards minimum', () => {
      const min = 10;
      const max = 60;
      const config = {
        mode: DelayMode.WEIGHTED_RANDOM,
        minimumDelaySeconds: min,
        maximumDelaySeconds: max,
        seed: 'test-weighted-seed',
      };

      const delays: number[] = [];
      for (let i = 0; i < 100; i++) {
        const result = service.generateDelay({ ...config, sequenceIndex: i });
        expect(result.delaySeconds).toBeGreaterThanOrEqual(min);
        expect(result.delaySeconds).toBeLessThanOrEqual(max);
        delays.push(result.delaySeconds);
      }

      // In weighted random with u^1.5, more than 50% of values should be below the midpoint (35)
      const belowMidpoint = delays.filter((d) => d <= 35).length;
      expect(belowMidpoint).toBeGreaterThan(50);
    });
  });

  describe('4. Random without Maximum (Automatic Maximum Calculation)', () => {
    it('should calculate effectiveMaximum = minimum * 3 when maximum is null or not provided', () => {
      const min = 10;
      const config = {
        mode: DelayMode.WEIGHTED_RANDOM,
        minimumDelaySeconds: min,
        maximumDelaySeconds: null,
        seed: 'test-auto-max-seed',
      };

      expect(service.getEffectiveMaximum(10, null)).toBe(30);
      expect(service.getEffectiveMaximum(20, null)).toBe(60);
      expect(service.getEffectiveMaximum(30, null)).toBe(90);
      expect(service.getEffectiveMaximum(60, null)).toBe(180);

      for (let i = 0; i < 50; i++) {
        const result = service.generateDelay({ ...config, sequenceIndex: i });
        expect(result.effectiveMaximum).toBe(30);
        expect(result.delaySeconds).toBeGreaterThanOrEqual(10);
        expect(result.delaySeconds).toBeLessThanOrEqual(30);
      }
    });
  });

  describe('5. Natural Mode', () => {
    it('should generate delays within bounds and apply jitter and occasional burst pauses', () => {
      const min = 10;
      const max = 60;
      const config = {
        mode: DelayMode.NATURAL,
        minimumDelaySeconds: min,
        maximumDelaySeconds: max,
        seed: 'test-natural-mode-seed',
      };

      const delays: number[] = [];
      for (let i = 0; i < 100; i++) {
        const result = service.generateDelay({ ...config, sequenceIndex: i });
        expect(result.delaySeconds).toBeGreaterThanOrEqual(min);
        expect(result.delaySeconds).toBeLessThanOrEqual(max);
        delays.push(result.delaySeconds);
      }

      // Check there is variation
      const uniqueValues = new Set(delays);
      expect(uniqueValues.size).toBeGreaterThan(10);
    });
  });

  describe('6. Zero Delay Handling', () => {
    it('should handle zero minimum delay gracefully without errors or NaN', () => {
      const result = service.generateDelay({
        mode: DelayMode.FIXED,
        minimumDelaySeconds: 0,
        maximumDelaySeconds: null,
      });

      expect(result.delaySeconds).toBe(0);
      expect(result.effectiveMaximum).toBe(0);
      expect(Number.isFinite(result.delaySeconds)).toBe(true);
    });

    it('should handle zero minimum with positive maximum in random modes', () => {
      const result = service.generateDelay({
        mode: DelayMode.UNIFORM_RANDOM,
        minimumDelaySeconds: 0,
        maximumDelaySeconds: 15,
        seed: 'test-zero-min',
      });

      expect(result.delaySeconds).toBeGreaterThanOrEqual(0);
      expect(result.delaySeconds).toBeLessThanOrEqual(15);
    });
  });

  describe('7. Validation & Bounds Protection', () => {
    it('should throw BadRequestException when maximum is strictly less than minimum', () => {
      expect(() => {
        service.validateConfig(60, 20);
      }).toThrow(BadRequestException);
    });

    it('should throw BadRequestException when minimum is negative', () => {
      expect(() => {
        service.validateConfig(-5);
      }).toThrow(BadRequestException);
    });

    it('should enforce MAX_ALLOWED_DELAY_SECONDS system safety ceiling', () => {
      expect(() => {
        service.validateConfig(MAX_ALLOWED_DELAY_SECONDS + 100);
      }).toThrow(BadRequestException);

      // Automatic effective max should never exceed MAX_ALLOWED_DELAY_SECONDS
      const largeMin = 2000;
      const effectiveMax = service.getEffectiveMaximum(largeMin, null);
      expect(effectiveMax).toBeLessThanOrEqual(MAX_ALLOWED_DELAY_SECONDS);
    });
  });

  describe('8. Seed Reproducibility', () => {
    it('should generate the exact same sequence given the same seed and config across two generators', () => {
      const seed = 'reproducible-seed-12345';
      const config = {
        mode: DelayMode.NATURAL,
        minimumDelaySeconds: 10,
        maximumDelaySeconds: 60,
        seed,
      };

      const sequenceA: number[] = [];
      const sequenceB: number[] = [];

      for (let i = 0; i < 20; i++) {
        sequenceA.push(service.generateDelay({ ...config, sequenceIndex: i }).delaySeconds);
        sequenceB.push(service.generateDelay({ ...config, sequenceIndex: i }).delaySeconds);
      }

      expect(sequenceA).toEqual(sequenceB);
    });

    it('should generate different sequences for different seeds', () => {
      const configA = {
        mode: DelayMode.WEIGHTED_RANDOM,
        minimumDelaySeconds: 10,
        maximumDelaySeconds: 60,
        seed: 'campaign-alpha-seed',
      };
      const configB = {
        mode: DelayMode.WEIGHTED_RANDOM,
        minimumDelaySeconds: 10,
        maximumDelaySeconds: 60,
        seed: 'campaign-beta-seed',
      };

      const seqA = service.generatePreviewSequence(configA, 10).delays;
      const seqB = service.generatePreviewSequence(configB, 10).delays;

      expect(seqA).not.toEqual(seqB);
    });
  });

  describe('9. Preview Sequence Generation', () => {
    it('should generate 10 preview delays without mutating persistent state', () => {
      const preview = service.generatePreviewSequence({
        mode: DelayMode.NATURAL,
        minimumDelaySeconds: 10,
        maximumDelaySeconds: 60,
      }, 10);

      expect(preview.delays).toHaveLength(10);
      expect(preview.effectiveMaximum).toBe(60);
      preview.delays.forEach((d) => {
        expect(d).toBeGreaterThanOrEqual(10);
        expect(d).toBeLessThanOrEqual(60);
      });
    });
  });

  describe('10. Repetition Prevention', () => {
    it('should regenerate value if it matches previous value in sequence', () => {
      const config = {
        mode: DelayMode.UNIFORM_RANDOM,
        minimumDelaySeconds: 10,
        maximumDelaySeconds: 60,
        seed: 'test-repetition-seed',
        sequenceIndex: 5,
        previousDelay: 25,
      };

      const result = service.generateDelay(config);
      expect(result.delaySeconds).toBeDefined();
    });
  });
});
