#import <Foundation/Foundation.h>
#import <Photos/Photos.h>
#import <React/RCTBridgeModule.h>

@interface VowFrameExportModule : NSObject <RCTBridgeModule>
@end

@implementation VowFrameExportModule

RCT_EXPORT_MODULE();

RCT_REMAP_METHOD(downloadExport,
                 downloadExport:(NSString *)urlString
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  [self downloadVideoFromURLString:urlString resolver:resolve rejecter:reject completion:nil];
}

RCT_REMAP_METHOD(saveVideoToPhotos,
                 saveVideoToPhotos:(NSString *)urlString
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  [self downloadVideoFromURLString:urlString resolver:resolve rejecter:reject completion:^(NSURL *fileURL) {
    [self requestPhotoWriteAccess:^(BOOL granted) {
      if (!granted) {
        reject(@"photo_permission_denied", @"Photo library write permission was denied.", nil);
        return;
      }

      [[PHPhotoLibrary sharedPhotoLibrary] performChanges:^{
        [PHAssetChangeRequest creationRequestForAssetFromVideoAtFileURL:fileURL];
      } completionHandler:^(BOOL success, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
          if (success) {
            resolve(@{@"fileUri": fileURL.absoluteString, @"saved": @YES});
          } else {
            reject(@"photo_save_failed", error.localizedDescription ?: @"Unable to save video.", error);
          }
        });
      }];
    }];
  }];
}

- (void)downloadVideoFromURLString:(NSString *)urlString
                          resolver:(RCTPromiseResolveBlock)resolve
                          rejecter:(RCTPromiseRejectBlock)reject
                        completion:(void (^)(NSURL *fileURL))completion
{
  NSURL *sourceURL = [NSURL URLWithString:urlString];
  if (!sourceURL) {
    reject(@"invalid_export_url", @"The export URL is invalid.", nil);
    return;
  }

  NSURLSessionDownloadTask *task = [[NSURLSession sharedSession] downloadTaskWithURL:sourceURL completionHandler:^(NSURL *location, NSURLResponse *response, NSError *error) {
    if (error) {
      reject(@"download_failed", error.localizedDescription, error);
      return;
    }

    NSHTTPURLResponse *httpResponse = [response isKindOfClass:NSHTTPURLResponse.class] ? (NSHTTPURLResponse *)response : nil;
    if (httpResponse && httpResponse.statusCode >= 400) {
      reject(@"download_failed", [NSString stringWithFormat:@"Export download failed with status %ld.", (long)httpResponse.statusCode], nil);
      return;
    }

    NSString *fileName = [NSString stringWithFormat:@"vowframe-%@.mp4", NSUUID.UUID.UUIDString.lowercaseString];
    NSURL *destinationURL = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:fileName]];
    [[NSFileManager defaultManager] removeItemAtURL:destinationURL error:nil];

    NSError *moveError = nil;
    BOOL moved = [[NSFileManager defaultManager] moveItemAtURL:location toURL:destinationURL error:&moveError];
    if (!moved) {
      reject(@"file_write_failed", moveError.localizedDescription ?: @"Unable to write downloaded export.", moveError);
      return;
    }

    if (completion) {
      completion(destinationURL);
      return;
    }

    resolve(@{@"fileUri": destinationURL.absoluteString, @"fileName": fileName});
  }];
  [task resume];
}

- (void)requestPhotoWriteAccess:(void (^)(BOOL granted))completion
{
  if (@available(iOS 14, *)) {
    PHAuthorizationStatus status = [PHPhotoLibrary authorizationStatusForAccessLevel:PHAccessLevelAddOnly];
    if (status == PHAuthorizationStatusAuthorized || status == PHAuthorizationStatusLimited) {
      completion(YES);
      return;
    }
    if (status == PHAuthorizationStatusDenied || status == PHAuthorizationStatusRestricted) {
      completion(NO);
      return;
    }
    [PHPhotoLibrary requestAuthorizationForAccessLevel:PHAccessLevelAddOnly handler:^(PHAuthorizationStatus newStatus) {
      completion(newStatus == PHAuthorizationStatusAuthorized || newStatus == PHAuthorizationStatusLimited);
    }];
    return;
  }

  PHAuthorizationStatus status = [PHPhotoLibrary authorizationStatus];
  if (status == PHAuthorizationStatusAuthorized) {
    completion(YES);
    return;
  }
  if (status == PHAuthorizationStatusDenied || status == PHAuthorizationStatusRestricted) {
    completion(NO);
    return;
  }
  [PHPhotoLibrary requestAuthorization:^(PHAuthorizationStatus newStatus) {
    completion(newStatus == PHAuthorizationStatusAuthorized);
  }];
}

@end
