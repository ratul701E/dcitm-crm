import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateLeadListDto,
  CreateLeadDto,
  UpdateLeadDto,
} from './dto/lead.dto';
import { Readable } from 'stream';
const csvParser = require('csv-parser');

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------
  // Lead Lists CRUD
  // --------------------------------------------------
  async createList(dto: CreateLeadListDto) {
    return this.prisma.leadList.create({
      data: {
        name: dto.name,
        description: dto.description,
      },
    });
  }

  async findAllLists() {
    return this.prisma.leadList.findMany({
      include: {
        _count: {
          select: { leads: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findListById(id: string) {
    const list = await this.prisma.leadList.findUnique({
      where: { id },
      include: {
        _count: {
          select: { leads: true },
        },
      },
    });
    if (!list) {
      throw new NotFoundException('Lead list not found');
    }
    return list;
  }

  async deleteList(id: string) {
    await this.findListById(id);
    return this.prisma.leadList.delete({
      where: { id },
    });
  }

  // --------------------------------------------------
  // Individual Leads CRUD
  // --------------------------------------------------
  async createLead(leadListId: string, dto: CreateLeadDto) {
    await this.findListById(leadListId);
    const email = dto.email.toLowerCase().trim();

    return this.prisma.lead.upsert({
      where: {
        leadListId_email: {
          leadListId,
          email,
        },
      },
      update: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        company: dto.company,
        jobTitle: dto.jobTitle,
        website: dto.website,
        linkedIn: dto.linkedIn,
        city: dto.city,
        country: dto.country,
        customVariables: dto.customVariables,
      },
      create: {
        leadListId,
        email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        company: dto.company,
        jobTitle: dto.jobTitle,
        website: dto.website,
        linkedIn: dto.linkedIn,
        city: dto.city,
        country: dto.country,
        customVariables: dto.customVariables,
      },
    });
  }

  async findLeadsByList(
    leadListId: string,
    page = 1,
    limit = 50,
    status?: string,
  ) {
    await this.findListById(leadListId);
    const skip = (page - 1) * limit;
    const where: any = { leadListId };
    if (status) {
      where.status = status;
    }

    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateLead(id: string, dto: UpdateLeadDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    return this.prisma.lead.update({
      where: { id },
      data: {
        status: dto.status,
        verificationStatus: dto.verificationStatus,
        customVariables: dto.customVariables
          ? {
              ...(lead.customVariables as object),
              ...dto.customVariables,
            }
          : undefined,
      },
    });
  }

  async deleteLead(id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    return this.prisma.lead.delete({ where: { id } });
  }

  // --------------------------------------------------
  // Streaming Bulk CSV Import Pipeline
  // --------------------------------------------------
  async importCsvStream(leadListId: string, fileBuffer: Buffer) {
    await this.findListById(leadListId);

    const stream = Readable.from(fileBuffer);
    const standardFields = new Set([
      'email',
      'firstname',
      'first_name',
      'lastname',
      'last_name',
      'company',
      'companyname',
      'company_name',
      'jobtitle',
      'job_title',
      'title',
      'website',
      'url',
      'linkedin',
      'linkedin_url',
      'city',
      'country',
    ]);

    let importedCount = 0;
    let duplicateOrSkippedCount = 0;
    const batchSize = 100;
    let batch: any[] = [];

    return new Promise((resolve, reject) => {
      stream
        .pipe(csvParser())
        .on('data', async (row: Record<string, string>) => {
          // Normalize header keys
          const normalized: Record<string, string> = {};
          for (const key of Object.keys(row)) {
            normalized[key.trim().toLowerCase()] = row[key]?.trim();
          }

          const rawEmail =
            normalized['email'] ||
            normalized['email address'] ||
            normalized['e-mail'];

          if (!rawEmail || !rawEmail.includes('@')) {
            duplicateOrSkippedCount++;
            return;
          }

          const email = rawEmail.toLowerCase();
          const firstName =
            normalized['firstname'] || normalized['first_name'] || null;
          const lastName =
            normalized['lastname'] || normalized['last_name'] || null;
          const company =
            normalized['company'] ||
            normalized['companyname'] ||
            normalized['company_name'] ||
            null;
          const jobTitle =
            normalized['jobtitle'] ||
            normalized['job_title'] ||
            normalized['title'] ||
            null;
          const website = normalized['website'] || normalized['url'] || null;
          const linkedIn =
            normalized['linkedin'] || normalized['linkedin_url'] || null;
          const city = normalized['city'] || null;
          const country = normalized['country'] || null;

          // Extract dynamic custom variables for everything else
          const customVariables: Record<string, any> = {};
          for (const key of Object.keys(normalized)) {
            if (!standardFields.has(key) && normalized[key]) {
              customVariables[key] = normalized[key];
            }
          }

          batch.push({
            leadListId,
            email,
            firstName,
            lastName,
            company,
            jobTitle,
            website,
            linkedIn,
            city,
            country,
            customVariables:
              Object.keys(customVariables).length > 0 ? customVariables : null,
          });

          if (batch.length >= batchSize) {
            stream.pause();
            const currentBatch = [...batch];
            batch = [];
            try {
              const res = await this.prisma.lead.createMany({
                data: currentBatch,
                skipDuplicates: true, // Company-wide list level deduplication
              });
              importedCount += res.count;
              duplicateOrSkippedCount += currentBatch.length - res.count;
              stream.resume();
            } catch (err) {
              stream.destroy(err as Error);
            }
          }
        })
        .on('end', async () => {
          if (batch.length > 0) {
            try {
              const res = await this.prisma.lead.createMany({
                data: batch,
                skipDuplicates: true,
              });
              importedCount += res.count;
              duplicateOrSkippedCount += batch.length - res.count;
            } catch (err) {
              return reject(err);
            }
          }
          resolve({
            success: true,
            importedCount,
            duplicateOrSkippedCount,
          });
        })
        .on('error', (err: any) => {
          this.logger.error(`CSV streaming import error: ${err.message}`);
          reject(new BadRequestException(`Failed to parse CSV: ${err.message}`));
        });
    });
  }
}
