import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { MigrationService } from './migration.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [CategoriesController],
  providers: [CategoriesService, MigrationService],
  exports: [CategoriesService, MigrationService],
})
export class CategoriesModule {}
