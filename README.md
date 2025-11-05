# NexGen Tax API Client

A Node.js application for interacting with the Magento Tax API to calculate, commit, and cancel tax transactions.

## Requirements

- Node.js (version 14 or higher)
- npm or yarn package manager

## Installation

1. Clone or download this repository
2. Navigate to the project directory
3. Install dependencies:

   ```bash
   npm install
   ```

## Dependencies

The project uses the following Node.js packages:

- `axios` (^1.7.9) - HTTP client for API requests
- `dotenv` (^16.4.7) - Environment variables loader
- `winston` (^3.17.0) - Logging library

## Environment Configuration

Create a `.env` file in the root directory with the following variables:

```env
BASE_URL=https://syn-magento.azurewebsites.net/api/
API_CODE=ABC123XYZ456DEFG789HIJK0LMNOPQRS==
OUTPUT_DIR=C:\Directorio_de_Trabajo\NEO\Taxes\respuesta
TEST_MODE=false
```

### Environment Variables Explained

- **BASE_URL**: The base URL for the Magento Tax API
- **API_CODE**: Authentication code for accessing the tax calculation endpoints
- **OUTPUT_DIR**: Directory where response files will be saved (will be created automatically if it doesn't exist)
- **TEST_MODE**: Set to `true` to use test endpoint (`STCCalcV3_TEST`), `false` for production endpoint (`STCCalcV3`)

## Usage

The application accepts three operations:

```bash
node index.js <operation> <json_file_path>
```

### Operations

1. **get_tax** - Calculate tax without committing the transaction

   ```bash
   node index.js get_tax input.json
   ```

   - Requires `"Committed": false` in the JSON file

2. **post_tax** - Calculate and commit the tax transaction

   ```bash
   node index.js post_tax input.json
   ```

   - Requires `"Committed": true` in the JSON file

3. **cancel_tax** - Cancel a previously committed transaction

   ```bash
   node index.js cancel_tax input.json
   ```

### Input File Format

The input JSON file should contain the transaction data in the format expected by the Magento Tax API. The `Committed` field is crucial:

- For `get_tax`: Set `"Committed": false`
- For `post_tax`: Set `"Committed": true`
- For `cancel_tax`: The `Committed` value is not validated

### Output

- Successful responses are saved as `RESPONSE_<original_filename>.json` in the directory specified by `OUTPUT_DIR`
- Error logs are saved in the `logs/` directory with daily rotation
- Console output shows success/error messages

## Logging

The application uses Winston for error logging:

- Log files are created daily in the `logs/` directory
- Format: `log_YYYY-MM-DD.log`
- Only error-level messages are logged to files

## Error Handling

The application validates:

- Command-line arguments
- Environment variables
- JSON file format
- `Committed` field values based on operation type
- API response handling

All errors are logged both to console and log files for debugging purposes.

## Project Structure

```tree
nexgen/
├── index.js                          # Entry point with dependency injection
├── src/
│   ├── cli/                          # CLI interface layer
│   ├── validators/                   # Business rules validation
│   ├── api/                          # HTTP API client
│   ├── storage/                      # File system operations
│   ├── infrastructure/               # Logging and cross-cutting concerns
│   └── config/                       # Configuration management
├── logs/                             # Application logs
├── .env                              # Environment variables
├── package.json                      # Project metadata and dependencies
├── package-lock.json                 # Exact dependency versions
└── README.md                         # This documentation
```

## Development

### Running Tests

```bash
# Coming soon - test suite with Jest
npm test
```

### Code Structure

Each layer is independent and testable:

- **CLI Layer**: Command parsing and orchestration
- **Validation Layer**: Business rules and data validation
- **API Layer**: HTTP communication with tax API
- **Storage Layer**: File operations
- **Infrastructure**: Logging, configuration

## Contributing

When adding new features:

1. Apply SOLID principles
2. Add appropriate error handling
3. Update tests and documentation
