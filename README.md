# mcp-wwjd — WordPress Publish MCP Server

Claude(Desktop/Code)에서 작성한 글을 워드프레스 사이트로 바로 발행/수정할 수 있게 해주는
[MCP(Model Context Protocol)](https://modelcontextprotocol.io) 서버입니다.

워드프레스의 REST API + Application Passwords(애플리케이션 비밀번호) 기능을 이용해서
플러그인 설치 없이 표준 REST API만으로 동작합니다.

## 제공 기능 (도구/Tools)

| 도구 | 설명 |
| --- | --- |
| `wp_create_post` | 새 글 작성 (마크다운 → HTML 자동 변환, 카테고리/태그 자동 생성) |
| `wp_update_post` | 기존 글 수정 (제목/본문/상태/카테고리/태그 등 부분 업데이트) |
| `wp_get_post` | 글 상세 조회 (원본 마크업 포함) |
| `wp_list_posts` | 글 검색/목록 조회 |
| `wp_delete_post` | 글 휴지통 이동 또는 완전 삭제 |
| `wp_upload_media` | 이미지 URL을 워드프레스 미디어 라이브러리에 업로드 (대표 이미지 지정용) |
| `wp_list_categories` | 카테고리 목록 조회 |
| `wp_list_tags` | 태그 목록 조회 |

기본적으로 글은 `draft`(초안) 상태로 생성되어, 워드프레스 관리자 화면에서 검토 후 발행할 수 있습니다.
바로 발행하려면 도구 호출 시 `status: "publish"`를 지정하면 됩니다.

## 0. 테스트할 워드프레스 사이트가 없다면? (Docker로 로컬 서버 구성)

실제 워드프레스 사이트가 없어도 `local-wordpress/` 폴더의 Docker Compose 설정으로
내 컴퓨터에 테스트용 워드프레스를 몇 분 안에 띄울 수 있습니다. (Docker Desktop 필요)

```bash
cd local-wordpress
./setup.sh
```

이 스크립트가 자동으로:
1. MySQL + WordPress 컨테이너를 실행 (`http://localhost:8080`)
2. WordPress 설치 마법사를 대신 실행 (admin 계정 자동 생성)
3. 고유주소(permalink)를 설정 (REST API의 `/wp-json/` 경로에 필요)
4. **Application Passwords 기능을 활성화** — 워드프레스는 HTTPS가 아닌 사이트에서는
   `WP_ENVIRONMENT_TYPE` 상수가 `local`로 설정돼 있지 않으면 이 기능을 기본적으로
   비활성화합니다. 로컬 Docker처럼 HTTP로만 접근하는 환경에서 흔히 걸리는 함정이라
   스크립트가 자동으로 처리합니다.
5. Application Password를 발급하고, `.env`에 그대로 붙여넣을 수 있는 값을 출력

출력된 `WP_SITE_URL` / `WP_USERNAME` / `WP_APP_PASSWORD` 값을 프로젝트 루트의 `.env`에
붙여넣으면, 아래 4·5단계(Claude 연동)를 실제 워드프레스 대신 이 로컬 사이트로 그대로
테스트할 수 있습니다. 관리자 화면은 브라우저에서 `http://localhost:8080/wp-admin`으로
접속해 확인할 수 있습니다 (로그인: `admin` / `TestPass123!`).

테스트가 끝나면 정리:
```bash
cd local-wordpress
docker compose down -v   # 컨테이너와 데이터를 모두 삭제
```

> 이 로컬 사이트는 어디까지나 개발/테스트용입니다. 실제 서비스 중인 워드프레스에
> 발행하려면 1단계부터 진행해 실제 사이트의 Application Password를 발급받으세요.

## 1. 워드프레스에서 Application Password 발급받기

1. 워드프레스 관리자 화면 로그인 → **사용자(Users) → 프로필(Profile)** 이동
2. 맨 아래 **Application Passwords(애플리케이션 비밀번호)** 섹션에서
   이름(예: `claude-mcp`)을 입력하고 **New Application Password** 클릭
3. 생성된 비밀번호(`xxxx xxxx xxxx xxxx xxxx xxxx` 형식)를 복사해둡니다.
   - 이 화면을 벗어나면 다시 볼 수 없으니 안전한 곳에 저장하세요.
   - Application Passwords 기능은 워드프레스 5.6 이상, 그리고 **사이트가 HTTPS**여야 사용 가능합니다.
     (로컬 개발 환경 등 HTTP만 가능한 경우 `WP Application Passwords` 관련 필터/플러그인으로 우회해야 합니다.)
4. 발행 권한이 있는 계정(관리자 또는 편집자 이상)의 Application Password를 사용하세요.

## 2. 설치 및 빌드

```bash
npm install
npm run build
```

`dist/index.js`가 생성됩니다. 이 파일을 stdio 기반 MCP 서버로 실행합니다.

## 3. 환경변수 설정

`.env.example`을 참고해 아래 값을 환경변수로 전달합니다 (MCP 클라이언트 설정에서 `env`로 넘기는 것을 권장):

- `WP_SITE_URL` — 워드프레스 사이트 주소 (예: `https://example.com`, 끝에 슬래시 없이)
- `WP_USERNAME` — Application Password를 발급받은 계정의 사용자명
- `WP_APP_PASSWORD` — 발급받은 Application Password
- `WP_DEFAULT_STATUS` — (선택) 글 생성 시 기본 상태, 기본값 `draft`

## 4. Claude Desktop / Claude Code에 등록하기

### Claude Desktop

`claude_desktop_config.json`에 아래와 같이 추가합니다.

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "node",
      "args": ["/절대/경로/mcp-wwjd/dist/index.js"],
      "env": {
        "WP_SITE_URL": "https://your-site.com",
        "WP_USERNAME": "your-wp-username",
        "WP_APP_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx"
      }
    }
  }
}
```

설정 후 Claude Desktop을 재시작하면 대화 중 도구 목록에 `wordpress` 서버의 도구들이 나타납니다.

### Claude Code (CLI)

```bash
claude mcp add wordpress \
  --env WP_SITE_URL=https://your-site.com \
  --env WP_USERNAME=your-wp-username \
  --env WP_APP_PASSWORD="xxxx xxxx xxxx xxxx xxxx xxxx" \
  -- node /절대/경로/mcp-wwjd/dist/index.js
```

## 5. 사용 예시

Claude에게 이렇게 요청하면 됩니다:

> "방금 쓴 글을 워드프레스에 초안으로 저장해줘. 제목은 'AI와 콘텐츠 마케팅', 카테고리는 '마케팅'으로 해줘."

Claude는 `wp_create_post` 도구를 호출해 마크다운 본문을 HTML로 변환하고,
카테고리가 없으면 자동 생성한 뒤 초안 글을 만듭니다. 응답으로 글 ID와
관리자 편집 링크(`/wp-admin/post.php?post=ID&action=edit`)를 돌려줍니다.

이후 "그 글 대표 이미지로 이 URL 이미지 넣어줘" → `wp_upload_media` + `wp_update_post`,
"바로 발행해줘" → `wp_update_post`(`status: "publish"`) 순으로 이어서 작업할 수 있습니다.

## 개발

```bash
npm run dev    # tsc --watch
npm run inspector  # MCP Inspector로 도구를 직접 테스트
```

## 트러블슈팅

| 증상 | 원인 | 해결 |
| --- | --- | --- |
| `401 rest_not_logged_in` | Application Password가 비활성화됨 (HTTPS가 아니고 `WP_ENVIRONMENT_TYPE`도 `local`이 아닌 경우) | HTTPS 사용, 또는 로컬 환경이면 `wp config set WP_ENVIRONMENT_TYPE local --type=constant` |
| `401 rest_not_logged_in` (그 외) | Authorization 헤더가 서버에서 탈락됨 (일부 Apache+PHP-FPM/공유호스팅) | `.htaccess`에 `RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]` 추가 |
| `403 rest_cannot_*` | 계정 권한 부족 | 편집자 이상 권한 계정의 Application Password 사용 |
| `404` + HTML 페이지 | 고유주소(permalink)가 "기본(Plain)"으로 설정됨 | 설정 → 고유주소를 "글 이름" 등으로 변경 |
| 이미지 업로드 실패 | 원본 이미지 URL이 공개 접근 불가, 또는 호스팅 업로드 용량 제한 | 공개 URL인지 확인, `upload_max_filesize` 확인 |

## 보안 참고사항

- Application Password는 일반 로그인 비밀번호와 별개이며, 필요 시 워드프레스 관리자에서 개별 폐기(Revoke)할 수 있습니다.
- `.env` 파일은 `.gitignore`에 포함되어 있어 커밋되지 않습니다. 절대 저장소에 커밋하지 마세요.
- 이 서버는 항상 사용자가 지정한 `WP_SITE_URL`의 REST API만 호출하며, 별도의 외부 서비스로 데이터를 전송하지 않습니다.
