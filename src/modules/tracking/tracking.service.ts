import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TrackingService {
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    const port = this.configService.get<number>('PORT', 3000);
    this.baseUrl = `http://localhost:${port}/api/tracking`;
  }

  /**
   * Rewrites HTML email body with open tracking pixel and click tracking links
   */
  injectTracking(
    htmlBody: string,
    emailLogId: string,
    trackOpens = true,
    trackClicks = true,
    customTrackingDomain?: string,
  ): string {
    const rootUrl = customTrackingDomain
      ? `https://${customTrackingDomain}/api/tracking`
      : this.baseUrl;

    let modified = htmlBody;

    // Inject click tracking proxies
    if (trackClicks) {
      modified = modified.replace(
        /href=["'](https?:\/\/[^"']+)["']/gi,
        (match, originalUrl) => {
          // Do not rewrite unsubscribe links
          if (originalUrl.includes('/unsubscribe')) {
            return match;
          }
          const proxyUrl = `${rootUrl}/click/${emailLogId}?url=${encodeURIComponent(originalUrl)}`;
          return `href="${proxyUrl}"`;
        },
      );
    }

    // Inject 1x1 open tracking pixel before </body> or at the end
    if (trackOpens) {
      const pixelTag = `<img src="${rootUrl}/open/${emailLogId}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;" />`;
      if (modified.includes('</body>')) {
        modified = modified.replace('</body>', `${pixelTag}</body>`);
      } else {
        modified += pixelTag;
      }
    }

    return modified;
  }
}
