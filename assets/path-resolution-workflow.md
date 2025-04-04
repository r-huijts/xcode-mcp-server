```mermaid
flowchart TD
    A[Input Path] -->|Raw Path| B[Path Expansion]
    B -->|Expanded Path| C[Path Normalization]
    C -->|Normalized Path| D{Is Absolute?}
    D -->|Yes| F[Validation]
    D -->|No| E[Resolution Against Active Directory]
    E -->|Absolute Path| F
    F -->|Valid Path| G{Operation Type}
    F -->|Invalid Path| H[PathAccessError]
    G -->|Read| I[Validate Read Access]
    G -->|Write| J[Validate Write Access]
    I -->|Allowed| K[Perform Read Operation]
    I -->|Denied| H
    J -->|Allowed| L[Perform Write Operation]
    J -->|Denied| H

    style A fill:#d0e0ff,stroke:#3080ff
    style B fill:#d0ffe0,stroke:#30ff80
    style C fill:#d0ffe0,stroke:#30ff80
    style E fill:#d0ffe0,stroke:#30ff80
    style F fill:#ffe0d0,stroke:#ff8030
    style H fill:#ffd0d0,stroke:#ff3030
    style I fill:#ffe0d0,stroke:#ff8030
    style J fill:#ffe0d0,stroke:#ff8030
    style K fill:#d0ffd0,stroke:#30ff30
    style L fill:#d0ffd0,stroke:#30ff30
```

The diagram shows the flow of path resolution in our system:

1. Starting with the raw input path
2. Expanding environment variables and tildes
3. Normalizing the path (removing redundancies)
4. Determining if it's absolute or needs resolution
5. Validating against security boundaries
6. Performing the appropriate operation if valid

Colors indicate:
- Blue: Input
- Green: Processing
- Orange: Validation
- Red: Error
- Bright Green: Success 