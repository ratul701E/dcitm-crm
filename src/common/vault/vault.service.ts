import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

@Injectable()
export class VaultService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const rawKey = this.configService.get<string>('ENCRYPTION_MASTER_KEY');
    if (!rawKey) {
      throw new InternalServerErrorException(
        'ENCRYPTION_MASTER_KEY is not defined in configuration',
      );
    }

    // Support 32-byte hex string (64 chars) or derive 32-byte buffer
    if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
      this.key = Buffer.from(rawKey, 'hex');
    } else {
      this.key = crypto.createHash('sha256').update(rawKey).digest();
    }
  }

  /**
   * Encrypts plaintext string or JSON object using AES-256-GCM
   */
  encrypt(data: string | object): EncryptedPayload {
    try {
      const plaintext =
        typeof data === 'object' ? JSON.stringify(data) : String(data);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

      let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
      ciphertext += cipher.final('hex');
      const authTag = cipher.getAuthTag().toString('hex');

      return {
        ciphertext,
        iv: iv.toString('hex'),
        authTag,
      };
    } catch (err: any) {
      throw new InternalServerErrorException('Encryption failed');
    }
  }

  /**
   * Decrypts an EncryptedPayload back into plaintext or parsed JSON
   */
  decrypt<T = any>(payload: EncryptedPayload, parseJson = false): T {
    try {
      if (!payload?.ciphertext || !payload?.iv || !payload?.authTag) {
        throw new BadRequestException('Invalid encrypted payload structure');
      }

      const iv = Buffer.from(payload.iv, 'hex');
      const authTag = Buffer.from(payload.authTag, 'hex');
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(payload.ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      if (parseJson) {
        return JSON.parse(decrypted) as T;
      }
      return decrypted as unknown as T;
    } catch (err: any) {
      throw new BadRequestException('Decryption failed or payload tampered');
    }
  }
}
