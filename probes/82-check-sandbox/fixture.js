// probes/82-check-sandbox/fixture.js
// A small made-up Mac app for check 82: an app, unit tests hosted in the app, and unit tests with no host. Each test
// tries the same three things from inside the test process, so the note can say whether a test `xcodebuild test`
// starts is still inside the sandbox: read the planted secret, write beside it, and read the keychain folder's
// listing (the count only). The answer goes to a file in the check folder, whatever the tests' own result.
import fs from 'node:fs';
import path from 'node:path';

const APP = 'Fix82';
const ID = (n) => `82${String(n).padStart(22, '0')}`;

function testSource(kind, { outside, tree, keychains }) {
  return `// A test that reports where it runs. Written by probes/82-check-sandbox/fixture.js.
import Foundation
import XCTest

final class Where${kind}Tests: XCTestCase {
  func testWhereThisRuns() throws {
    let secret = (try? String(contentsOfFile: ${JSON.stringify(path.join(outside, 'secret.txt'))}, encoding: .utf8)) != nil
    let wrote = FileManager.default.createFile(atPath: ${JSON.stringify(path.join(outside, `proof-test-${kind}`))}, contents: Data("x".utf8))
    let keychains = ((try? FileManager.default.contentsOfDirectory(atPath: ${JSON.stringify(keychains)})) ?? []).count
    let line = "{\\"kind\\":\\"${kind}\\",\\"readSecret\\":\\(secret),\\"wroteOutside\\":\\(wrote),\\"keychainFiles\\":\\(keychains),\\"home\\":\\"\\(NSHomeDirectory())\\",\\"pid\\":\\(getpid()),\\"parent\\":\\(getppid())}\\n"
    let places = [${JSON.stringify(path.join(tree, `where-${kind}.json`))}, ${JSON.stringify(path.join(path.dirname(outside), `where-${kind}.json`))}]
    for place in places { try? line.write(toFile: place, atomically: false, encoding: .utf8) }
    XCTAssertTrue(true)
  }
}
`;
}

const appSource = ({ outside, tree, keychains }) => `// The app the hosted tests run in, reporting from its first line as a project's own code could. Written by probes/82-check-sandbox/fixture.js.
import AppKit

@main
final class Fix82Main: NSObject, NSApplicationDelegate {
  static func main() {
    report()
    let app = NSApplication.shared
    let delegate = Fix82Main()
    app.delegate = delegate
    app.setActivationPolicy(.prohibited)
    app.run()
  }

  static func report() {
    let secret = (try? String(contentsOfFile: ${JSON.stringify(path.join(outside, 'secret.txt'))}, encoding: .utf8)) != nil
    let wrote = FileManager.default.createFile(atPath: ${JSON.stringify(path.join(outside, 'proof-test-App'))}, contents: Data("x".utf8))
    let keychains = ((try? FileManager.default.contentsOfDirectory(atPath: ${JSON.stringify(keychains)})) ?? []).count
    let line = "{\\"kind\\":\\"App\\",\\"readSecret\\":\\(secret),\\"wroteOutside\\":\\(wrote),\\"keychainFiles\\":\\(keychains),\\"pid\\":\\(getpid()),\\"parent\\":\\(getppid())}\\n"
    for place in [${JSON.stringify(path.join(tree, 'where-App.json'))}, ${JSON.stringify(path.join(path.dirname(outside), 'where-App.json'))}] { try? line.write(toFile: place, atomically: false, encoding: .utf8) }
  }
}
`;

function target(n, name, type, product, group, config) {
  return `    ${ID(n)} = { isa = PBXNativeTarget; buildConfigurationList = ${ID(config)}; buildPhases = (${ID(n + 1)}, ); buildRules = (); dependencies = (${n === 10 ? '' : `${ID(n + 2)}, `}); fileSystemSynchronizedGroups = (${ID(group)}, ); name = ${name}; productName = ${name}; productReference = ${ID(product)}; productType = "${type}"; };
    ${ID(n + 1)} = { isa = PBXSourcesBuildPhase; files = (); };`;
}

function config(n, name, settings) {
  const lines = Object.entries(settings).map(([key, value]) => `${key} = "${value}";`).join(' ');
  return `    ${ID(n)} = { isa = XCBuildConfiguration; buildSettings = { ${lines} }; name = ${name}; };`;
}

function pbxproj() {
  const common = { MACOSX_DEPLOYMENT_TARGET: '13.0', SWIFT_VERSION: '5.0', GENERATE_INFOPLIST_FILE: 'YES', CURRENT_PROJECT_VERSION: '1', MARKETING_VERSION: '1.0', SDKROOT: 'macosx', ONLY_ACTIVE_ARCH: 'YES', ENABLE_USER_SCRIPT_SANDBOXING: 'NO' };
  const app = { ...common, PRODUCT_NAME: APP, PRODUCT_BUNDLE_IDENTIFIER: 'invalid.wheelhouse.fix82' };
  const hosted = { ...common, PRODUCT_NAME: 'HostedTests', PRODUCT_BUNDLE_IDENTIFIER: 'invalid.wheelhouse.fix82.hosted', TEST_HOST: `$(BUILT_PRODUCTS_DIR)/${APP}.app/Contents/MacOS/${APP}`, BUNDLE_LOADER: '$(TEST_HOST)' };
  const bare = { ...common, PRODUCT_NAME: 'BareTests', PRODUCT_BUNDLE_IDENTIFIER: 'invalid.wheelhouse.fix82.bare' };
  return `// !$*UTF8*$!
{
  archiveVersion = 1; classes = {}; objectVersion = 77;
  objects = {
    ${ID(1)} = { isa = PBXProject; attributes = { LastUpgradeCheck = 2700; }; buildConfigurationList = ${ID(2)}; compatibilityVersion = "Xcode 15.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base, ); mainGroup = ${ID(3)}; productRefGroup = ${ID(4)}; projectDirPath = ""; projectRoot = ""; targets = (${ID(10)}, ${ID(20)}, ${ID(30)}, ); };
    ${ID(2)} = { isa = XCConfigurationList; buildConfigurations = (${ID(5)}, ); defaultConfigurationName = Debug; };
    ${ID(3)} = { isa = PBXGroup; children = (${ID(41)}, ${ID(42)}, ${ID(43)}, ${ID(4)}, ); sourceTree = "<group>"; };
    ${ID(4)} = { isa = PBXGroup; children = (${ID(51)}, ${ID(52)}, ${ID(53)}, ); name = Products; sourceTree = "<group>"; };
${config(5, 'Debug', { CODE_SIGNING_ALLOWED: 'NO', DEBUG_INFORMATION_FORMAT: 'dwarf', ENABLE_TESTABILITY: 'YES', SWIFT_OPTIMIZATION_LEVEL: '-Onone' })}
    ${ID(41)} = { isa = PBXFileSystemSynchronizedRootGroup; path = ${APP}; sourceTree = "<group>"; };
    ${ID(42)} = { isa = PBXFileSystemSynchronizedRootGroup; path = HostedTests; sourceTree = "<group>"; };
    ${ID(43)} = { isa = PBXFileSystemSynchronizedRootGroup; path = BareTests; sourceTree = "<group>"; };
    ${ID(51)} = { isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = ${APP}.app; sourceTree = BUILT_PRODUCTS_DIR; };
    ${ID(52)} = { isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = HostedTests.xctest; sourceTree = BUILT_PRODUCTS_DIR; };
    ${ID(53)} = { isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = BareTests.xctest; sourceTree = BUILT_PRODUCTS_DIR; };
${target(10, APP, 'com.apple.product-type.application', 51, 41, 12)}
    ${ID(12)} = { isa = XCConfigurationList; buildConfigurations = (${ID(13)}, ); defaultConfigurationName = Debug; };
${config(13, 'Debug', app)}
${target(20, 'HostedTests', 'com.apple.product-type.bundle.unit-test', 52, 42, 24)}
    ${ID(22)} = { isa = PBXTargetDependency; target = ${ID(10)}; targetProxy = ${ID(23)}; };
    ${ID(23)} = { isa = PBXContainerItemProxy; containerPortal = ${ID(1)}; proxyType = 1; remoteGlobalIDString = ${ID(10)}; remoteInfo = ${APP}; };
    ${ID(24)} = { isa = XCConfigurationList; buildConfigurations = (${ID(25)}, ); defaultConfigurationName = Debug; };
${config(25, 'Debug', hosted)}
${target(30, 'BareTests', 'com.apple.product-type.bundle.unit-test', 53, 43, 34)}
    ${ID(32)} = { isa = PBXTargetDependency; target = ${ID(10)}; targetProxy = ${ID(33)}; };
    ${ID(33)} = { isa = PBXContainerItemProxy; containerPortal = ${ID(1)}; proxyType = 1; remoteGlobalIDString = ${ID(10)}; remoteInfo = ${APP}; };
    ${ID(34)} = { isa = XCConfigurationList; buildConfigurations = (${ID(35)}, ); defaultConfigurationName = Debug; };
${config(35, 'Debug', bare)}
  };
  rootObject = ${ID(1)};
}
`;
}

function testable(n, name) {
  return `<TestableReference skipped="NO"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${ID(n)}" BuildableName="${name}.xctest" BlueprintName="${name}" ReferencedContainer="container:${APP}.xcodeproj"></BuildableReference></TestableReference>`;
}

function scheme() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.7">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES">
    <BuildActionEntries>
      <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">
        <BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${ID(10)}" BuildableName="${APP}.app" BlueprintName="${APP}" ReferencedContainer="container:${APP}.xcodeproj"></BuildableReference>
      </BuildActionEntry>
    </BuildActionEntries>
  </BuildAction>
  <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES">
    <Testables>${testable(20, 'HostedTests')}${testable(30, 'BareTests')}</Testables>
  </TestAction>
  <LaunchAction buildConfiguration="Debug" launchStyle="0" useCustomWorkingDirectory="NO"></LaunchAction>
</Scheme>
`;
}

// Writes the made-up project into `tree`. Gives its scheme and its container's name.
export function writeFixture(tree, { outside, keychains }) {
  const files = {
    [`${APP}/${APP}.swift`]: appSource({ outside, tree, keychains }),
    'HostedTests/WhereHostedTests.swift': testSource('Hosted', { outside, tree, keychains }),
    'BareTests/WhereBareTests.swift': testSource('Bare', { outside, tree, keychains }),
    [`${APP}.xcodeproj/project.pbxproj`]: pbxproj(),
    [`${APP}.xcodeproj/xcshareddata/xcschemes/${APP}.xcscheme`]: scheme(),
    '.gitignore': '.build/\n',
  };
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(tree, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return { scheme: APP, container: `${APP}.xcodeproj` };
}
