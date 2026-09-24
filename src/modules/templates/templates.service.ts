import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTemplateDto) {
    return this.prisma.emailTemplate.create({
      data: {
        name: dto.name,
        subject: dto.subject,
        body: dto.body || '',
        htmlContent: dto.htmlContent || null,
        designJson: dto.designJson ? dto.designJson as Prisma.InputJsonValue : Prisma.JsonNull,
        description: dto.description || null,
        previewText: dto.previewText || null,
        category: dto.category || 'general',
        variables: dto.variables || [],
      },
    });
  }

  async findAll() {
    return this.prisma.emailTemplate.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        subject: true,
        previewText: true,
        description: true,
        category: true,
        variables: true,
        createdAt: true,
        updatedAt: true,
        // Return a truncated htmlContent for list view (first 500 chars for preview)
        htmlContent: true,
        designJson: true,
        body: true,
      },
    });
  }

  async findOne(id: string) {
    const template = await this.prisma.emailTemplate.findUnique({
      where: { id },
    });
    if (!template) {
      throw new NotFoundException('Template not found');
    }
    return template;
  }

  async update(id: string, dto: UpdateTemplateDto) {
    await this.findOne(id);
    return this.prisma.emailTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.subject !== undefined && { subject: dto.subject }),
        ...(dto.body !== undefined && { body: dto.body }),
        ...(dto.htmlContent !== undefined && { htmlContent: dto.htmlContent }),
        ...(dto.designJson !== undefined && { designJson: dto.designJson }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.previewText !== undefined && { previewText: dto.previewText }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.variables !== undefined && { variables: dto.variables }),
      },
    });
  }

  async duplicate(id: string) {
    const source = await this.findOne(id);
    return this.prisma.emailTemplate.create({
      data: {
        name: `${source.name} (Copy)`,
        subject: source.subject,
        body: source.body,
        htmlContent: source.htmlContent || null,
        designJson: source.designJson ? source.designJson as Prisma.InputJsonValue : Prisma.JsonNull,
        description: source.description || null,
        previewText: source.previewText || null,
        category: source.category,
        variables: source.variables,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.emailTemplate.delete({
      where: { id },
    });
  }
}
