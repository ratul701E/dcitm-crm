import { Injectable, Logger } from '@nestjs/common';
import * as dns from 'dns/promises';

export interface DnsCheckResult {
  spfRecordPass: boolean;
  dkimRecordPass: boolean;
  dmarcRecordPass: boolean;
  mxRecordPass: boolean;
  ctdCnamePass: boolean;
  details: {
    spfRecords: string[];
    dkimRecords: string[];
    dmarcRecords: string[];
    mxRecords: string[];
    cnameRecords: string[];
  };
}

@Injectable()
export class DnsAuditorService {
  private readonly logger = new Logger(DnsAuditorService.name);

  /**
   * Audit all critical deliverability DNS records for a domain
   */
  async auditDomain(domain: string, dkimSelector = 'google'): Promise<DnsCheckResult> {
    const cleanDomain = domain.trim().toLowerCase();

    const [spf, dkim, dmarc, mx, ctd] = await Promise.all([
      this.checkSpf(cleanDomain),
      this.checkDkim(cleanDomain, dkimSelector),
      this.checkDmarc(cleanDomain),
      this.checkMx(cleanDomain),
      this.checkCtd(cleanDomain),
    ]);

    return {
      spfRecordPass: spf.pass,
      dkimRecordPass: dkim.pass,
      dmarcRecordPass: dmarc.pass,
      mxRecordPass: mx.pass,
      ctdCnamePass: ctd.pass,
      details: {
        spfRecords: spf.records,
        dkimRecords: dkim.records,
        dmarcRecords: dmarc.records,
        mxRecords: mx.records,
        cnameRecords: ctd.records,
      },
    };
  }

  private async checkSpf(domain: string): Promise<{ pass: boolean; records: string[] }> {
    try {
      const records = await dns.resolveTxt(domain);
      const flat = records.map((r) => r.join(''));
      const spf = flat.filter((txt) => txt.toLowerCase().startsWith('v=spf1'));
      return { pass: spf.length > 0, records: spf };
    } catch {
      return { pass: false, records: [] };
    }
  }

  private async checkDkim(
    domain: string,
    selector: string,
  ): Promise<{ pass: boolean; records: string[] }> {
    try {
      const dkimHost = `${selector}._domainkey.${domain}`;
      const records = await dns.resolveTxt(dkimHost);
      const flat = records.map((r) => r.join(''));
      const dkim = flat.filter(
        (txt) => txt.includes('v=DKIM1') || txt.includes('p='),
      );
      return { pass: dkim.length > 0, records: dkim };
    } catch {
      return { pass: false, records: [] };
    }
  }

  private async checkDmarc(domain: string): Promise<{ pass: boolean; records: string[] }> {
    try {
      const dmarcHost = `_dmarc.${domain}`;
      const records = await dns.resolveTxt(dmarcHost);
      const flat = records.map((r) => r.join(''));
      const dmarc = flat.filter((txt) => txt.toLowerCase().startsWith('v=dmarc1'));
      return { pass: dmarc.length > 0, records: dmarc };
    } catch {
      return { pass: false, records: [] };
    }
  }

  private async checkMx(domain: string): Promise<{ pass: boolean; records: string[] }> {
    try {
      const mx = await dns.resolveMx(domain);
      return {
        pass: mx && mx.length > 0,
        records: mx.map((m) => `${m.exchange} (priority: ${m.priority})`),
      };
    } catch {
      return { pass: false, records: [] };
    }
  }

  private async checkCtd(domain: string): Promise<{ pass: boolean; records: string[] }> {
    try {
      // Custom tracking domain is often configured as a subdomain like tracking.<domain> or ctd.<domain>
      const cnameHost = `tracking.${domain}`;
      const cnames = await dns.resolveCname(cnameHost);
      return { pass: cnames && cnames.length > 0, records: cnames };
    } catch {
      return { pass: false, records: [] };
    }
  }
}
