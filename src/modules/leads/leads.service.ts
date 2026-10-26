import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateLeadListDto,
  CreateLeadDto,
  UpdateLeadDto,
} from './dto/lead.dto';
import { LeadStatus } from '@prisma/client';
import { Readable } from 'stream';
const csvParser = require('csv-parser');

export const SYSTEM_SUBSCRIBERS_LIST_NAME = 'Subscribers';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------
  // Lead Lists CRUD
  // --------------------------------------------------
  async createList(dto: CreateLeadListDto) {
    // System name protection: user lists cannot be named the reserved system list name
    if (dto.name.trim().toLowerCase() === SYSTEM_SUBSCRIBERS_LIST_NAME.toLowerCase()) {
      throw new BadRequestException(
        `The list name "${SYSTEM_SUBSCRIBERS_LIST_NAME}" is reserved for system use. Please choose a different name.`,
      );
    }

    // Validate parent category if provided
    let parentCategoryId: string | null = null;
    let sortOrder = dto.sortOrder ?? 0;

    if (dto.parentCategoryId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: dto.parentCategoryId },
      });
      if (!parent) {
        throw new BadRequestException('Target parent category not found.');
      }
      if (parent.level !== 2) {
        throw new BadRequestException('Audience groups can only be placed under a Level 2 Subcategory.');
      }
      parentCategoryId = parent.id;

      if (dto.sortOrder === undefined) {
        const maxSort = await this.prisma.leadList.findFirst({
          where: { parentCategoryId: parent.id },
          orderBy: { sortOrder: 'desc' },
          select: { sortOrder: true },
        });
        sortOrder = (maxSort?.sortOrder ?? -1) + 1;
      }
    }

    // Duplicate audience group name check within the same subcategory/container
    const existingGroup = await this.prisma.leadList.findFirst({
      where: {
        parentCategoryId,
        name: { equals: dto.name.trim(), mode: 'insensitive' },
      },
    });
    if (existingGroup) {
      throw new ConflictException(
        `An audience group named "${dto.name.trim()}" already exists in this ${parentCategoryId ? 'subcategory' : 'list category'}.`,
      );
    }

    const list = await this.prisma.leadList.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim(),
        parentCategoryId,
        sortOrder,
        isSystem: false,
      },
    });

    if (dto.leadIds && dto.leadIds.length > 0) {
      const existingLeads = await this.prisma.lead.findMany({
        where: { id: { in: dto.leadIds } },
      });

      if (existingLeads.length > 0) {
        await this.prisma.lead.createMany({
          data: existingLeads.map((l) => ({
            leadListId: list.id,
            email: l.email,
            firstName: l.firstName,
            lastName: l.lastName,
            company: l.company,
            jobTitle: l.jobTitle,
            website: l.website,
            linkedIn: l.linkedIn,
            city: l.city,
            country: l.country,
            customVariables: l.customVariables as any,
            leadScore: l.leadScore,
            tags: l.tags,
            verificationStatus: l.verificationStatus,
            status: LeadStatus.NEW,
            currentStepOrder: 1,
            nextScheduledAt: null,
          })),
          skipDuplicates: true,
        });
      }
    }

    return this.findListById(list.id);
  }

  async findAllLists() {
    return this.prisma.leadList.findMany({
      include: {
        _count: {
          select: { leads: true },
        },
      },
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'desc' }],
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
    const list = await this.findListById(id);
    if (list.isSystem) {
      throw new ForbiddenException('System-maintained lists cannot be deleted.');
    }
    return this.prisma.leadList.delete({
      where: { id },
    });
  }

  /**
   * Auto-maintains the static Subscribers list.
   * Finds or provisions the system list named "Subscribers" (isSystem: true).
   */
  async getOrCreateSubscribersList() {
    let list = await this.prisma.leadList.findFirst({
      where: { isSystem: true, name: SYSTEM_SUBSCRIBERS_LIST_NAME },
      include: { _count: { select: { leads: true } } },
    });

    if (!list) {
      list = await this.prisma.leadList.findFirst({
        where: { name: { equals: SYSTEM_SUBSCRIBERS_LIST_NAME, mode: 'insensitive' } },
        include: { _count: { select: { leads: true } } },
      });
      if (list) {
        list = await this.prisma.leadList.update({
          where: { id: list.id },
          data: { isSystem: true, name: SYSTEM_SUBSCRIBERS_LIST_NAME },
          include: { _count: { select: { leads: true } } },
        });
      }
    }

    if (!list) {
      list = await this.prisma.leadList.create({
        data: {
          name: SYSTEM_SUBSCRIBERS_LIST_NAME,
          description: 'System-maintained static list for email subscribers',
          isSystem: true,
        },
        include: { _count: { select: { leads: true } } },
      });
      this.logger.log(`[LeadsService] Auto-provisioned system Subscribers list (${list.id})`);
    }

    return list;
  }

  /**
   * Enrolls an email into the static Subscribers list.
   * Matches existing lead contacts across all lists to merge rich profile data.
   */
  async enrollInSubscribersList(rawEmail: string) {
    if (!rawEmail || typeof rawEmail !== 'string') {
      throw new BadRequestException('A valid email address is required (e.g. ?email=user@example.com)');
    }

    const email = rawEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException(`"${rawEmail}" is not a valid email address.`);
    }

    // 1. Auto-maintain static subscribers list
    const subscribersList = await this.getOrCreateSubscribersList();

    // 2. Query all existing leads across all lists matching this email
    const matchedLeads = await this.prisma.lead.findMany({
      where: { email: { equals: email, mode: 'insensitive' } },
      orderBy: { updatedAt: 'desc' },
    });

    // 3. Extract richest profile data from matched leads
    let firstName: string | null = null;
    let lastName: string | null = null;
    let company: string | null = null;
    let jobTitle: string | null = null;
    let website: string | null = null;
    let linkedIn: string | null = null;
    let city: string | null = null;
    let country: string | null = null;
    let customVariables: Record<string, any> = {};
    const tags = new Set<string>(['Subscriber']);
    let leadScore = 50;

    for (const lead of matchedLeads) {
      if (!firstName && lead.firstName) firstName = lead.firstName;
      if (!lastName && lead.lastName) lastName = lead.lastName;
      if (!company && lead.company) company = lead.company;
      if (!jobTitle && lead.jobTitle) jobTitle = lead.jobTitle;
      if (!website && lead.website) website = lead.website;
      if (!linkedIn && lead.linkedIn) linkedIn = lead.linkedIn;
      if (!city && lead.city) city = lead.city;
      if (!country && lead.country) country = lead.country;
      if (lead.customVariables && typeof lead.customVariables === 'object') {
        customVariables = { ...customVariables, ...(lead.customVariables as any) };
      }
      if (Array.isArray(lead.tags)) {
        lead.tags.forEach((t) => tags.add(t));
      }
      if (lead.leadScore && lead.leadScore > leadScore) {
        leadScore = lead.leadScore;
      }
    }

    // 4. Upsert lead into the Subscribers static list
    const savedLead = await this.prisma.lead.upsert({
      where: {
        leadListId_email: {
          leadListId: subscribersList.id,
          email,
        },
      },
      update: {
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        company: company || undefined,
        jobTitle: jobTitle || undefined,
        website: website || undefined,
        linkedIn: linkedIn || undefined,
        city: city || undefined,
        country: country || undefined,
        customVariables: Object.keys(customVariables).length > 0 ? (customVariables as any) : undefined,
        tags: Array.from(tags),
        status: LeadStatus.NEW,
      },
      create: {
        leadListId: subscribersList.id,
        email,
        firstName,
        lastName,
        company,
        jobTitle,
        website,
        linkedIn,
        city,
        country,
        customVariables: Object.keys(customVariables).length > 0 ? (customVariables as any) : undefined,
        tags: Array.from(tags),
        leadScore,
        status: LeadStatus.NEW,
        currentStepOrder: 1,
      },
    });

    const alreadyInSubscribers = matchedLeads.some((l) => l.leadListId === subscribersList.id);

    this.logger.log(
      `[Subscribers] Contact ${email} saved to Subscribers list (Matched ${matchedLeads.length} existing records)`,
    );

    return {
      success: true,
      message: alreadyInSubscribers
        ? `Lead ${email} was already in Subscribers list; profile refreshed with latest details.`
        : `Lead ${email} successfully saved to Subscribers static list.`,
      matchedExistingRecords: matchedLeads.length,
      lead: savedLead,
      list: {
        id: subscribersList.id,
        name: subscribersList.name,
        isSystem: subscribersList.isSystem,
      },
    };
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
        leadScore: dto.leadScore !== undefined ? dto.leadScore : undefined,
        tags: dto.tags,
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
        leadScore: dto.leadScore !== undefined ? dto.leadScore : 50,
        tags: dto.tags || [],
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
    const where: any = { leadListId, deletedAt: null };
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

  async findAllLeads(
    page = 1,
    limit = 50,
    search?: string,
    status?: string,
    leadListId?: string,
    isTrash = false,
  ) {
    const where: any = {};
    if (isTrash || status === 'trash') {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
    }
    if (status && status !== 'trash') {
      where.status = status;
    }
    if (leadListId) {
      where.leadListId = leadListId;
    }
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (leadListId) {
      const skip = (page - 1) * limit;
      const [items, total] = await Promise.all([
        this.prisma.lead.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            leadList: {
              select: { id: true, name: true },
            },
          },
        }),
        this.prisma.lead.count({ where }),
      ]);

      const formatted = items.map((l) => ({
        ...l,
        lists: l.leadList ? [l.leadList] : [],
        allLeadIds: [l.id],
      }));

      return {
        items: formatted,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }

    // Global Contacts directory: group by unique email address
    const allMatching = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        leadList: {
          select: { id: true, name: true },
        },
      },
    });

    const emailMap = new Map<string, any>();
    for (const lead of allMatching) {
      const emailKey = lead.email.toLowerCase().trim();
      if (!emailMap.has(emailKey)) {
        emailMap.set(emailKey, {
          ...lead,
          lists: lead.leadList ? [lead.leadList] : [],
          allLeadIds: [lead.id],
        });
      } else {
        const existing = emailMap.get(emailKey);
        existing.allLeadIds.push(lead.id);
        if (lead.leadList && !existing.lists.some((l: any) => l.id === lead.leadList.id)) {
          existing.lists.push(lead.leadList);
        }
        if (Array.isArray(lead.tags)) {
          existing.tags = Array.from(new Set([...existing.tags, ...lead.tags]));
        }
        if (!existing.firstName && lead.firstName) existing.firstName = lead.firstName;
        if (!existing.lastName && lead.lastName) existing.lastName = lead.lastName;
        if (!existing.company && lead.company) existing.company = lead.company;
        if (!existing.jobTitle && lead.jobTitle) existing.jobTitle = lead.jobTitle;
      }
    }

    const deduplicated = Array.from(emailMap.values());
    const total = deduplicated.length;
    const skip = (page - 1) * limit;
    const paginatedItems = deduplicated.slice(skip, skip + limit);

    return {
      items: paginatedItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async enrollLeadInList(leadId: string, targetListId: string) {
    await this.findListById(targetListId);
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    return this.prisma.lead.upsert({
      where: {
        leadListId_email: {
          leadListId: targetListId,
          email: lead.email,
        },
      },
      update: {
        firstName: lead.firstName,
        lastName: lead.lastName,
        company: lead.company,
        jobTitle: lead.jobTitle,
        status: LeadStatus.NEW,
        nextScheduledAt: null,
        currentStepOrder: 1,
      },
      create: {
        leadListId: targetListId,
        email: lead.email,
        firstName: lead.firstName,
        lastName: lead.lastName,
        company: lead.company,
        jobTitle: lead.jobTitle,
        website: lead.website,
        linkedIn: lead.linkedIn,
        city: lead.city,
        country: lead.country,
        customVariables: lead.customVariables as any,
        leadScore: lead.leadScore,
        tags: lead.tags,
        status: LeadStatus.NEW,
        currentStepOrder: 1,
      },
    });
  }

  async updateLead(id: string, dto: UpdateLeadDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    try {
      return await this.prisma.lead.update({
        where: { id },
        data: {
          email: dto.email !== undefined ? dto.email : undefined,
          firstName: dto.firstName !== undefined ? dto.firstName : undefined,
          lastName: dto.lastName !== undefined ? dto.lastName : undefined,
          company: dto.company !== undefined ? dto.company : undefined,
          jobTitle: dto.jobTitle !== undefined ? dto.jobTitle : undefined,
          website: dto.website !== undefined ? dto.website : undefined,
          linkedIn: dto.linkedIn !== undefined ? dto.linkedIn : undefined,
          city: dto.city !== undefined ? dto.city : undefined,
          country: dto.country !== undefined ? dto.country : undefined,
          status: dto.status,
          verificationStatus: dto.verificationStatus,
          leadScore: dto.leadScore !== undefined ? dto.leadScore : undefined,
          tags: dto.tags !== undefined ? dto.tags : undefined,
          customVariables: dto.customVariables
            ? {
                ...(lead.customVariables as object),
                ...dto.customVariables,
              }
            : undefined,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestException('A contact with this email already exists in this list');
      }
      throw err;
    }
  }

  async deleteLead(id: string, allLists = false, permanent = false) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    if (permanent) {
      if (allLists) {
        return this.prisma.lead.deleteMany({ where: { email: lead.email } });
      }
      return this.prisma.lead.delete({ where: { id } });
    }
    // Soft delete
    const now = new Date();
    if (allLists) {
      return this.prisma.lead.updateMany({
        where: { email: lead.email },
        data: { deletedAt: now },
      });
    }
    return this.prisma.lead.update({
      where: { id },
      data: { deletedAt: now },
    });
  }

  async restoreLead(id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    return this.prisma.lead.updateMany({
      where: { email: lead.email },
      data: { deletedAt: null },
    });
  }

  async bulkDeleteLeads(ids: string[]) {
    // Default bulk delete is soft delete to move to trash
    return this.bulkSoftDeleteLeads(ids);
  }

  async bulkSoftDeleteLeads(ids: string[]) {
    if (!ids || ids.length === 0) {
      return { count: 0 };
    }
    const leads = await this.prisma.lead.findMany({
      where: { id: { in: ids } },
      select: { email: true },
    });
    const emails = Array.from(new Set(leads.map((l) => l.email)));
    const now = new Date();
    const result = await this.prisma.lead.updateMany({
      where: {
        OR: [{ id: { in: ids } }, { email: { in: emails } }],
      },
      data: { deletedAt: now },
    });
    return { count: result.count };
  }

  async bulkRestoreLeads(ids: string[]) {
    if (!ids || ids.length === 0) {
      return { count: 0 };
    }
    const leads = await this.prisma.lead.findMany({
      where: { id: { in: ids } },
      select: { email: true },
    });
    const emails = Array.from(new Set(leads.map((l) => l.email)));
    const result = await this.prisma.lead.updateMany({
      where: {
        OR: [{ id: { in: ids } }, { email: { in: emails } }],
      },
      data: { deletedAt: null },
    });
    return { count: result.count };
  }

  async bulkPermanentDeleteLeads(ids: string[]) {
    if (!ids || ids.length === 0) {
      return { count: 0 };
    }
    const leads = await this.prisma.lead.findMany({
      where: { id: { in: ids } },
      select: { email: true },
    });
    const emails = Array.from(new Set(leads.map((l) => l.email)));
    const result = await this.prisma.lead.deleteMany({
      where: {
        OR: [{ id: { in: ids } }, { email: { in: emails } }],
      },
    });
    return { count: result.count };
  }

  async createListWithLeads(dto: { name: string; description?: string; leadIds: string[] }) {
    const trimmedName = dto.name.trim();
    if (trimmedName.toLowerCase() === SYSTEM_SUBSCRIBERS_LIST_NAME.toLowerCase()) {
      throw new BadRequestException(
        `The list name "${SYSTEM_SUBSCRIBERS_LIST_NAME}" is reserved for system use. Please choose a different name.`,
      );
    }

    const list = await this.prisma.leadList.create({
      data: {
        name: trimmedName,
        description: dto.description?.trim(),
        isSystem: false,
      },
    });

    if (!dto.leadIds || dto.leadIds.length === 0) {
      return { list, enrolledCount: 0 };
    }

    const sourceLeads = await this.prisma.lead.findMany({
      where: { id: { in: dto.leadIds } },
    });

    // Deduplicate unique emails
    const uniqueMap = new Map<string, (typeof sourceLeads)[0]>();
    for (const l of sourceLeads) {
      const emailKey = l.email.toLowerCase().trim();
      if (!uniqueMap.has(emailKey)) {
        uniqueMap.set(emailKey, l);
      }
    }

    let enrolledCount = 0;
    for (const source of uniqueMap.values()) {
      await this.prisma.lead.upsert({
        where: {
          leadListId_email: {
            leadListId: list.id,
            email: source.email,
          },
        },
        update: {
          deletedAt: null,
          firstName: source.firstName,
          lastName: source.lastName,
          company: source.company,
          jobTitle: source.jobTitle,
          website: source.website,
          linkedIn: source.linkedIn,
          city: source.city,
          country: source.country,
          customVariables: (source.customVariables as any) ?? undefined,
          leadScore: source.leadScore,
          tags: source.tags,
          verificationStatus: source.verificationStatus,
          status: source.status,
        },
        create: {
          leadListId: list.id,
          email: source.email,
          firstName: source.firstName,
          lastName: source.lastName,
          company: source.company,
          jobTitle: source.jobTitle,
          website: source.website,
          linkedIn: source.linkedIn,
          city: source.city,
          country: source.country,
          customVariables: (source.customVariables as any) ?? undefined,
          leadScore: source.leadScore,
          tags: source.tags,
          verificationStatus: source.verificationStatus,
          status: source.status,
        },
      });
      enrolledCount++;
    }

    return { list, enrolledCount };
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
