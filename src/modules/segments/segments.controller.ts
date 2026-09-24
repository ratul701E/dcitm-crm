import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { SegmentsService } from './segments.service';
import { CreateSegmentDto, UpdateSegmentDto } from './dto/segment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Audience Segments')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('segments')
export class SegmentsController {
  constructor(private readonly segmentsService: SegmentsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Create a new audience segment filter' })
  @ApiResponse({ status: 201, description: 'Segment created successfully' })
  create(@Body() dto: CreateSegmentDto) {
    return this.segmentsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all audience segments' })
  @ApiResponse({ status: 200, description: 'Segments list retrieved' })
  findAll() {
    return this.segmentsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get segment details by ID' })
  @ApiParam({ name: 'id', description: 'Segment UUID' })
  findOne(@Param('id') id: string) {
    return this.segmentsService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Update an audience segment' })
  @ApiParam({ name: 'id', description: 'Segment UUID' })
  update(@Param('id') id: string, @Body() dto: UpdateSegmentDto) {
    return this.segmentsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MEMBER)
  @ApiOperation({ summary: 'Delete an audience segment' })
  @ApiParam({ name: 'id', description: 'Segment UUID' })
  remove(@Param('id') id: string) {
    return this.segmentsService.remove(id);
  }
}
