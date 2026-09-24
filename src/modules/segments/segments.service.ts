import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSegmentDto, UpdateSegmentDto } from './dto/segment.dto';

@Injectable()
export class SegmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSegmentDto) {
    return this.prisma.segment.create({
      data: {
        name: dto.name,
        description: dto.description,
        conditions: dto.conditions,
        count: dto.count || 0,
      },
    });
  }

  async findAll() {
    return this.prisma.segment.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const segment = await this.prisma.segment.findUnique({
      where: { id },
    });
    if (!segment) {
      throw new NotFoundException('Segment not found');
    }
    return segment;
  }

  async update(id: string, dto: UpdateSegmentDto) {
    await this.findOne(id);
    return this.prisma.segment.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        conditions: dto.conditions,
        count: dto.count,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.segment.delete({
      where: { id },
    });
  }
}
