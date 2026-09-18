import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    this.client = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  getClient(): Redis {
    return this.client;
  }

  async blocklistToken(token: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(`bl:${token}`, '1', 'EX', ttlSeconds);
    } catch {
      // Allow graceful operation when local redis is still starting
    }
  }

  async isTokenBlocklisted(token: string): Promise<boolean> {
    try {
      const result = await this.client.get(`bl:${token}`);
      return result !== null;
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
