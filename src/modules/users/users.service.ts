import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InviteUserDto, UpdateUserDto } from './dto/user.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async invite(dto: InviteUserDto, actorUserId?: string) {
    const email = dto.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    let firstName = dto.firstName;
    let lastName = dto.lastName;

    if (!firstName && dto.name) {
      const parts = dto.name.trim().split(' ');
      firstName = parts[0];
      lastName = parts.slice(1).join(' ') || '';
    }

    if (!firstName) {
      firstName = email.split('@')[0];
    }
    if (!lastName) {
      lastName = '';
    }

    // Generate random secure temporary password
    const tempPassword = crypto.randomBytes(12).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        role: dto.role || 'MEMBER',
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    await this.auditService.log({
      actorUserId,
      action: 'USER_INVITE',
      targetEntity: 'User',
      targetId: user.id,
      metadata: { email, role: user.role },
      status: 'success',
    });

    return {
      ...user,
      tempPassword,
    };
  }

  async update(id: string, dto: UpdateUserDto, actorUserId?: string) {
    await this.findOne(id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        role: dto.role,
        isActive: dto.isActive,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        updatedAt: true,
      },
    });

    await this.auditService.log({
      actorUserId,
      action: 'USER_UPDATE',
      targetEntity: 'User',
      targetId: id,
      metadata: dto,
      status: 'success',
    });

    return updated;
  }

  async remove(id: string, actorUserId?: string) {
    if (actorUserId && actorUserId === id) {
      throw new BadRequestException('You cannot delete your own account');
    }

    await this.findOne(id);

    const deleted = await this.prisma.user.delete({
      where: { id },
      select: {
        id: true,
        email: true,
      },
    });

    await this.auditService.log({
      actorUserId,
      action: 'USER_DELETE',
      targetEntity: 'User',
      targetId: id,
      metadata: { email: deleted.email },
      status: 'success',
    });

    return deleted;
  }
}
