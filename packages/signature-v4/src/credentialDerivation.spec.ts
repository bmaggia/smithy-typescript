import { Sha256 } from "@aws-crypto/sha256-js";
import { AwsCredentialIdentity } from "@smithy/types";
import { toHex } from "@smithy/util-hex-encoding";

import {
  addOneToArray, buildFixedInputBuffer,
  clearCredentialCache,
  createSigV4Scope, getSigV4aSigningKey,
  getSigV4SigningKey,
  isBiggerThanNMinus2
} from "./credentialDerivation";
import {N_MINUS_TWO} from "./constants";

describe("createScope", () => {
  it("should create a scoped identifier for the credentials used", () => {
    expect(createSigV4Scope("date", "region", "service")).toBe("date/region/service/aws4_request");
  });
});

describe("signatureV4 signing key", () => {
  beforeEach(clearCredentialCache);

  const credentials: AwsCredentialIdentity = {
    accessKeyId: "foo",
    secretAccessKey: "bar",
  };
  const shortDate = "19700101";
  const region = "us-foo-1";
  const service = "bar";

  it(
    "should return a buffer containing a signing key derived from the" +
      " provided credentials, date, region, and service",
    () => {
      return expect(getSigV4SigningKey(Sha256, credentials, shortDate, region, service).then(toHex)).resolves.toBe(
        "b7c34d23320b5cd909500c889eac033a33c93f5a4bf67f71988a58f299e62e0a"
      );
    }
  );

  it("should trap errors encountered while hashing", () => {
    return expect(
      getSigV4SigningKey(
        jest.fn(() => {
          throw new Error("PANIC");
        }),
        credentials,
        shortDate,
        region,
        service
      )
    ).rejects.toMatchObject(new Error("PANIC"));
  });

  describe("caching", () => {
    it("should return the same signing key when called with the same date, region, service, and credentials", async () => {
      const mockSha256Constructor = jest.fn().mockImplementation((args) => {
        return new Sha256(args);
      });
      const key1 = await getSigV4SigningKey(mockSha256Constructor, credentials, shortDate, region, service);
      const key2 = await getSigV4SigningKey(mockSha256Constructor, credentials, shortDate, region, service);
      expect(key1).toBe(key2);
      expect(mockSha256Constructor).toHaveBeenCalledTimes(6);
    });

    it("should cache a maximum of 50 entries", async () => {
      const keys: Array<Uint8Array> = new Array(50);
      // fill the cache
      for (let i = 0; i < 50; i++) {
        keys[i] = await getSigV4SigningKey(Sha256, credentials, shortDate, `us-foo-${i.toString(10)}`, service);
      }

      // evict the oldest member from the cache
      await getSigV4SigningKey(Sha256, credentials, shortDate, `us-foo-50`, service);

      // the second oldest member should still be in cache
      await expect(getSigV4SigningKey(Sha256, credentials, shortDate, `us-foo-1`, service)).resolves.toStrictEqual(keys[1]);

      // the oldest member should not be in the cache
      await expect(getSigV4SigningKey(Sha256, credentials, shortDate, `us-foo-0`, service)).resolves.not.toBe(keys[0]);
    });
  });
});

describe("signatureV4a signing key", () => {
  it("should get signing key", async () => {
    const secret = 'test-secret';
    const accessKey = 'test-access-key';

    const mockSha256Constructor = jest.fn().mockImplementation((args) => {
      return new Sha256(args);
    });

    const result = await getSigV4aSigningKey(mockSha256Constructor, secret, accessKey);

    const expectedResult = new Uint8Array([
      107, 171, 179, 226,  62, 241,  77, 131,
      240, 163, 149,  40, 120, 236, 169, 100,
      28, 130,  40,  97, 214, 239,  24,  15,
      158, 224,  37,  30, 241,  83, 119, 174
    ]);

    expect(result).toEqual(expectedResult);
  })

  it('buildFixedInputBuffer', () => {
    const startBuffer = "start";
    const accessKey = "key";
    const result = buildFixedInputBuffer(startBuffer, accessKey,1)

    expect(result).toEqual('start   AWS4-ECDSA-P256-SHA256 key   ');
  });

  it('addOneToArray, no carry', () => {
    const originalValue = new Uint8Array(32);
    originalValue[31] = 0xFE;

    const result = addOneToArray(originalValue);

    expect(result.length).toEqual(32);
    expect(result[31]).toEqual(0xFF);
    expect(result[30]).toEqual(0x00);
  });

  it('addOneToArray, carry', () => {
    const originalValue = new Uint8Array(32);
    originalValue[31] = 0xFF;
    originalValue[30] = 0xFF;
    originalValue[29] = 0xFE;

    const result = addOneToArray(originalValue);

    expect(result.length).toEqual(32);
    expect(result[31]).toEqual(0x00);
    expect(result[30]).toEqual(0x00);
    expect(result[29]).toEqual(0xFF);
  });

  it('addOneToArray, carry to last digit', () => {
    const originalValue = new Uint8Array(32);
    for (let i = 0; i < originalValue.length; i++) {
      originalValue[i] = 0xFF;
    }

    const result = addOneToArray(originalValue);

    expect(result.length).toEqual(33);

    expect(result[0]).toEqual(0x01);

    for (let i = 1; i < originalValue.length; i++) {
      expect(result[i]).toEqual(0x00);
    }
  });

  it('Number smaller than NMinus2', () => {
    let comparisonNumber = new Uint8Array(32);

    let result = isBiggerThanNMinus2(comparisonNumber);
    expect(result).toBeFalsy();

    comparisonNumber = new Uint8Array(N_MINUS_TWO);
    comparisonNumber[31] = comparisonNumber[31] - 1;

    result = isBiggerThanNMinus2(comparisonNumber);
    expect(result).toBeFalsy();
  });

  it('Number bigger than NMinus2', () => {
    let comparisonNumber = new Uint8Array(32);
    comparisonNumber[0] = 0xFF;
    comparisonNumber[1] = 0xFF;
    comparisonNumber[2] = 0xFF;
    comparisonNumber[3] = 0xFF;
    comparisonNumber[4] = 0x01;

    let result = isBiggerThanNMinus2(comparisonNumber);
    expect(result).toBeTruthy();

    comparisonNumber = new Uint8Array(N_MINUS_TWO);
    comparisonNumber[31] = comparisonNumber[31] + 1;

    result = isBiggerThanNMinus2(comparisonNumber);
    expect(result).toBeTruthy();
  });

  it('Number equals NMinus2', () => {
    const comparisonNumber = new Uint8Array(N_MINUS_TWO);

    const result = isBiggerThanNMinus2(comparisonNumber);

    expect(result).toBeFalsy();
  });
});
