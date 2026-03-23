import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootGradlePath = resolve('src-tauri', 'gen', 'android', 'build.gradle.kts');
const appGradlePath = resolve('src-tauri', 'gen', 'android', 'app', 'build.gradle.kts');

function ensureImport(text, line) {
  return text.includes(line) ? text : `${line}\n${text}`;
}

let rootGradle = readFileSync(rootGradlePath, 'utf8');
if (!rootGradle.includes('com.google.gms:google-services:4.4.2')) {
  if (rootGradle.includes('buildscript {')) {
    rootGradle = rootGradle.replace(
      /buildscript\s*\{([\s\S]*?)dependencies\s*\{([\s\S]*?)\n\s*}\s*\}/m,
      (match, buildscriptBody, dependencyBody) => {
        if (dependencyBody.includes('com.google.gms:google-services:4.4.2')) {
          return match;
        }

        return match.replace(
          /dependencies\s*\{([\s\S]*?)\n\s*}/m,
          `dependencies {${dependencyBody}
        classpath("com.google.gms:google-services:4.4.2")
    }`,
        );
      },
    );
  } else {
    rootGradle += `

buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.google.gms:google-services:4.4.2")
    }
}
`;
  }
}
writeFileSync(rootGradlePath, rootGradle);

let appGradle = readFileSync(appGradlePath, 'utf8');
appGradle = ensureImport(appGradle, 'import java.io.FileInputStream');
appGradle = ensureImport(appGradle, 'import java.util.Properties');

if (!appGradle.includes('signingConfigs {') && appGradle.includes('buildTypes {')) {
  appGradle = appGradle.replace(
    'buildTypes {',
    `signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            val keystoreProperties = Properties()
            if (keystorePropertiesFile.exists()) {
                keystoreProperties.load(FileInputStream(keystorePropertiesFile))
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["password"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["password"] as String
            }
        }
    }

    buildTypes {`,
  );
}

if (!appGradle.includes('signingConfig = signingConfigs.getByName("release")')) {
  appGradle = appGradle.replace(
    /getByName\("release"\)\s*\{/,
    `getByName("release") {
            signingConfig = signingConfigs.getByName("release")`,
  );
}

if (!appGradle.includes('com.google.gms.google-services')) {
  appGradle += '\napply(plugin = "com.google.gms.google-services")\n';
}

writeFileSync(appGradlePath, appGradle);
