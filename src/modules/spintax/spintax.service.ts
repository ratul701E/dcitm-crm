import { Injectable } from '@nestjs/common';

@Injectable()
export class SpintaxService {
  /**
   * Recursively parses nested Spintax structures: {Hi|Hello|Hey {there|}}
   */
  parseSpintax(text: string): string {
    if (!text) return '';
    const spintaxRegex = /\{([^{}]+)\}/g;

    let parsed = text;
    while (spintaxRegex.test(parsed)) {
      parsed = parsed.replace(spintaxRegex, (_, choices) => {
        const options = choices.split('|');
        const randomIndex = Math.floor(Math.random() * options.length);
        return options[randomIndex];
      });
    }

    return parsed;
  }

  /**
   * Interpolates standard variables and custom nested variables with fallback support.
   * Syntax examples:
   *  {{firstName}}
   *  {{companyName | your company}}
   *  {{customVariables.techStack | your platform}}
   */
  interpolateVariables(
    template: string,
    variables: Record<string, any>,
  ): string {
    if (!template) return '';

    return template.replace(/\{\{\s*([\w.]+)(?:\s*\|\s*([^}]+))?\s*\}\}/g, (match, key, fallback) => {
      const val = this.resolveValue(variables, key);
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return String(val);
      }
      return fallback ? fallback.trim() : '';
    });
  }

  /**
   * Resolves nested property path (e.g. "customVariables.techStack")
   */
  private resolveValue(obj: Record<string, any>, path: string): any {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  }

  /**
   * Complete render pipeline: interpolates dynamic variables first, then resolves Spintax variations
   */
  render(template: string, variables: Record<string, any>): string {
    const interpolated = this.interpolateVariables(template, variables);
    return this.parseSpintax(interpolated);
  }
}
