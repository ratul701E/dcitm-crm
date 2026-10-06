import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Search')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Global search across Groups, Leads, and Campaigns',
    description:
      'Performs categorized full-text lookup across contact lists/groups, leads/contacts, and email campaigns.',
  })
  @ApiQuery({
    name: 'q',
    required: true,
    type: String,
    description: 'Search keyword query',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max results per category (default: 5)',
  })
  @ApiResponse({
    status: 200,
    description: 'Categorized search results returned successfully',
  })
  async search(@Query() queryDto: SearchQueryDto) {
    return this.searchService.searchGlobal(queryDto.q, queryDto.limit ?? 5);
  }
}
